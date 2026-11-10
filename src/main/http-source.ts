import { lookup } from 'node:dns/promises'
import { Readable } from 'node:stream'
import type { Album, SongRef, Track } from '../shared/types.ts'
import { logger } from './log.ts'
import { isPrivateHost } from './net.ts'
import type { HttpPlayable, HttpTrack } from './providers/types.ts'
import { SourceError } from './source.ts'
import type { StreamableFile } from './stream-server.ts'

const log = logger('http-source')

const MAX_ALBUMS = 50
const MAX_REDIRECTS = 5
/** How long what we learned about a file (its length, where its redirect led) is trusted. */
const PROBE_TTL_MS = 10 * 60_000
/** Waiting for the server to start answering; the body itself can take as long as the song plays. */
const HEADERS_TIMEOUT_MS = 20_000

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}
const FORMAT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
  'audio/aac': 'AAC',
  'audio/ogg': 'OGG',
  'audio/webm': 'WEBM',
  'audio/flac': 'FLAC',
  'audio/wav': 'WAV'
}

export interface HttpSourceOptions {
  /** Tests only: allow plain http and private addresses, and skip the DNS check. */
  allowPrivate?: boolean
}

/** What one request to the upstream found out about a file. */
interface Probe {
  at: number
  /** Where the request ended up after redirects */
  url: string
  length: number
  mime: string
  /** The upstream honours Range; otherwise we fetch from the start and skip bytes */
  rangeable: boolean
}

interface Entry {
  track: HttpTrack
  probe?: Probe
}

const extensionOf = (url: string): string => {
  try {
    const name = new URL(url).pathname.split('/').pop() ?? ''
    return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  } catch {
    return ''
  }
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/**
 * Plays http albums: tracks that are plain https audio files (a plugin found the URLs). The player's <audio>
 * element asks the loopback stream server for a track; this proxies the request to the upstream with the same Range,
 * so playback starts as soon as the first bytes arrive and seeking fetches from the new position.
 *
 * Only public https hosts are contacted, every redirect hop included, and redirects can't carry cookies elsewhere.
 */
export class HttpSource {
  private readonly albums = new Map<string, { album: Album; entries: Entry[]; origin: HttpPlayable['origin'] }>()
  private readonly mediaBaseUrl: string
  private readonly allowPrivate: boolean

  constructor(mediaBaseUrl: string, options: HttpSourceOptions = {}) {
    this.mediaBaseUrl = mediaBaseUrl
    this.allowPrivate = options.allowPrivate === true
  }

  has(infoHash: string): boolean {
    return this.albums.has(infoHash)
  }

  /** Opens an album (nothing is fetched until a track is played). */
  load(playable: HttpPlayable): Album {
    if (playable.tracks.length === 0) throw new SourceError('That source has no playable tracks.')
    const base = `${this.mediaBaseUrl}/${playable.id}`
    const artist = playable.hints?.artist ?? playable.artist
    const tracks: Track[] = playable.tracks.map((t, index) => ({
      id: `${playable.id}:${index}`,
      key: `${index + 1}-${slug(t.title) || 'track'}`,
      fileIndex: index,
      title: t.title,
      artist: t.artist ?? artist,
      trackNo: playable.tracks.length > 1 ? index + 1 : undefined,
      duration: t.duration,
      format: t.format ?? FORMAT_BY_MIME[t.mime ?? ''] ?? (extensionOf(t.url).toUpperCase() || 'STREAM'),
      size: 0,
      url: `${base}/${index}`
    }))
    const entries: Entry[] = playable.tracks.map(track => ({ track }))
    // The cover goes through the stream server too, as one more file: the player window may only load images from there.
    let coverUrl: string | undefined
    if (playable.coverUrl) {
      entries.push({ track: { title: 'Cover', url: playable.coverUrl } })
      coverUrl = `${base}/${entries.length - 1}`
    }
    const album: Album = {
      infoHash: playable.id,
      source: 'http',
      title: playable.hints?.title ?? playable.title,
      artist,
      coverUrl,
      tracks,
      totalSize: 0
    }
    this.albums.delete(playable.id)
    this.albums.set(playable.id, { album, entries, origin: playable.origin })
    if (this.albums.size > MAX_ALBUMS) {
      const oldest = this.albums.keys().next().value
      if (oldest !== undefined) this.albums.delete(oldest)
    }
    log.info(`opened “${album.title}”: ${tracks.length} track(s)`)
    return album
  }

  /** What's needed to rate a track and find it again later (the counterpart of TorrentEngine.songInfo). */
  songInfo(infoHash: string, key: string): Omit<SongRef, 'id' | 'fingerprint'> | undefined {
    const loaded = this.albums.get(infoHash)
    const track = loaded?.album.tracks.find(t => t.key === key)
    if (!loaded || !track) return undefined
    return {
      infoHash,
      key,
      title: track.title,
      artist: track.artist,
      album: loaded.album.title,
      duration: track.duration,
      http: loaded.origin
    }
  }

  /** The stream server's lookup for a media URL of an http album. */
  async resolveFile(infoHash: string, fileIndex: number): Promise<StreamableFile | undefined> {
    const entry = this.albums.get(infoHash)?.entries[fileIndex]
    if (!entry) return undefined
    const probe = await this.probe(entry, `${infoHash}/${fileIndex}`)
    return {
      length: probe.length,
      mime: probe.mime,
      createReadStream: (start, end) => Readable.from(this.read(entry, `${infoHash}/${fileIndex}`, start, end))
    }
  }

  /** Asks the upstream for the first byte: gives the file's length (and shows early if the link is dead). */
  private async probe(entry: Entry, what: string): Promise<Probe> {
    if (entry.probe && Date.now() - entry.probe.at < PROBE_TTL_MS) return entry.probe
    const { track } = entry
    const { res, url } = await this.request(track.url, track.headers, 'bytes=0-0')
    try {
      if (!res.ok) {
        throw new SourceError(`The source didn’t give the audio (HTTP ${res.status}).`)
      }
      const rangeable = res.status === 206
      let length: number
      if (rangeable) {
        const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]
        length = total ? Number(total) : Number.NaN
      } else {
        length = Number(res.headers.get('content-length'))
      }
      if (!Number.isFinite(length) || length <= 0) {
        throw new SourceError('That source can’t be streamed: the server doesn’t say how long the file is.')
      }
      const probe: Probe = { at: Date.now(), url, length, mime: this.mimeOf(track, res), rangeable }
      entry.probe = probe
      log.debug(`${what}: ${length} bytes, ${probe.mime}${rangeable ? '' : ', no Range support'}`)
      return probe
    } finally {
      await res.body?.cancel().catch(() => {})
    }
  }

  private mimeOf(track: HttpTrack, res: Response): string {
    const served = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    // Only audio and image types are passed on (the cover is an image): never html or script from a server.
    if (/^(audio|image)\/[a-z0-9.+-]+$/.test(served) && served !== 'image/svg+xml') return served
    return track.mime ?? MIME_BY_EXTENSION[extensionOf(track.url)] ?? 'audio/mpeg'
  }

  /** The bytes `start`..`end` (inclusive) of a track. */
  private async *read(
    entry: Entry,
    what: string,
    start: number,
    end: number,
    retried = false
  ): AsyncGenerator<Uint8Array> {
    const probe = await this.probe(entry, what)
    const { res } = await this.request(
      probe.url,
      entry.track.headers,
      probe.rangeable ? `bytes=${start}-${end}` : undefined
    )
    // A link that has gone stale (signed URLs expire): learn it again from the original once.
    if (!retried && (res.status === 403 || res.status === 404 || res.status === 410)) {
      log.warn(`${what}: the upstream answered ${res.status}; looking the file up again`)
      await res.body?.cancel().catch(() => {})
      entry.probe = undefined
      yield* this.read(entry, what, start, end, true)
      return
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {})
      throw new SourceError(`The source stopped sending the audio (HTTP ${res.status}).`)
    }
    // A server that ignored the Range header sends the whole file: skip up to `start`.
    let skip = res.status === 200 ? start : 0
    let remaining = end - start + 1
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      const part = skip > 0 ? chunk.subarray(skip) : chunk
      skip = 0
      // Stop at `end` even if the upstream sends more (it ignored the Range); leaving the loop cancels the download.
      if (part.length >= remaining) {
        yield part.subarray(0, remaining)
        return
      }
      remaining -= part.length
      yield part
    }
  }

  /** One GET that follows redirects by hand, so every hop is checked. */
  private async request(
    rawUrl: string,
    headers: Record<string, string> | undefined,
    range: string | undefined
  ): Promise<{ res: Response; url: string }> {
    let current = new URL(rawUrl)
    let sent = { ...headers }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertAllowed(current)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timed out')), HEADERS_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(current, {
          headers: { ...sent, ...(range ? { Range: range } : {}) },
          redirect: 'manual',
          signal: controller.signal
        })
      } catch (err) {
        log.warn(`couldn’t reach ${current.host}:`, err)
        throw new SourceError('Couldn’t reach the source’s server.')
      } finally {
        clearTimeout(timer)
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) return { res, url: current.toString() }
      await res.body?.cancel().catch(() => {})
      const next = new URL(location, current)
      // Sign-in details stay with the host they were meant for.
      if (next.origin !== current.origin) {
        sent = Object.fromEntries(Object.entries(sent).filter(([name]) => !/^(cookie|authorization)$/i.test(name)))
      }
      current = next
    }
    throw new SourceError('The source redirected too many times.')
  }

  /** https, no odd port, and a public address: what the hostname says and what it resolves to. */
  private async assertAllowed(url: URL): Promise<void> {
    if (this.allowPrivate) return
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) {
      throw new SourceError('The source used a link that isn’t allowed.')
    }
    if (isPrivateHost(url.hostname)) throw new SourceError('The source pointed at a private address.')
    let addresses: Array<{ address: string }>
    try {
      addresses = await lookup(url.hostname, { all: true })
    } catch {
      throw new SourceError('Couldn’t find the source’s server.')
    }
    if (addresses.some(({ address }) => isPrivateHost(address) || address === '::' || address.startsWith('0.'))) {
      throw new SourceError('The source pointed at a private address.')
    }
  }
}
