import { randomUUID } from 'node:crypto'
import path from 'node:path'
import WebTorrent, { type Torrent } from 'webtorrent'
import type { Album, SourceHints, TorrentStats, Track } from '../shared/types.ts'
import { buildLibrary } from './library.ts'
import { SourceError } from './source.ts'
import type { StreamableFile } from './stream-server.ts'

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

const READY_TIMEOUT_MS = 90_000
// Caps against hostile metadata: real albums and discographies stay far below these.
const MAX_FILES = 50_000
const MAX_TRACKS = 5_000
const MAX_PIECE_LENGTH = 64 * 1024 * 1024

export interface TrackAnnotation {
  title?: string
  artist?: string
  trackNo?: number
  duration?: number
}

interface LoadedTorrent {
  torrent: Torrent
  album: Album
  /** Only these file indexes may be streamed, each with a fixed MIME type. */
  servable: Map<number, string>
}

const extensionOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/** Owns the WebTorrent client and maps torrents to playable albums. */
export class TorrentEngine {
  private readonly client: WebTorrent
  private readonly loaded = new Map<string, LoadedTorrent>()
  private readonly pending = new Map<string, Promise<Album>>()
  private readonly cacheDir: string
  private readonly mediaBaseUrl: string

  constructor(cacheDir: string, mediaBaseUrl: string) {
    this.cacheDir = path.resolve(cacheDir)
    this.mediaBaseUrl = mediaBaseUrl
    // No UPnP / NAT-PMP: never open ports on the user's router behind their back.
    // No uTP: WebTorrent retries uTP several times before falling back to TCP, which stalls
    // for ~30s per peer on networks that drop UDP (common on corporate Wi-Fi).
    this.client = new WebTorrent({ natUpnp: false, natPmp: false, utp: false })
    this.client.on('error', (err: unknown) => console.error('[torrent] client error:', errorMessage(err)))
  }

  load(torrentId: string | Uint8Array, hints: SourceHints = {}): Promise<Album> {
    if (typeof torrentId !== 'string') return this.loadNow(torrentId, hints)
    // A magnet's info hash is only known asynchronously, so de-duplicate concurrent loads here.
    let promise = this.pending.get(torrentId)
    if (!promise) {
      promise = this.loadNow(torrentId, hints).finally(() => this.pending.delete(torrentId))
      this.pending.set(torrentId, promise)
    }
    return promise
  }

  private async loadNow(torrentId: string | Uint8Array, hints: SourceHints): Promise<Album> {
    let torrent: Torrent | null
    try {
      torrent = await this.client.get(torrentId as never)
    } catch {
      throw new SourceError("That isn't a valid torrent.")
    }
    torrent ??= this.client.add(torrentId as never, {
      // Our own random folder per torrent: with addUID the store root would be built from the
      // torrent's unsanitised `name` field, which a hostile torrent can set to "../../somewhere".
      path: path.join(this.cacheDir, randomUUID()),
      addUID: false,
      // Nothing downloads until a track is actually streamed.
      deselect: true,
      destroyStoreOnDestroy: true
    })

    await whenReady(torrent)
    const existing = this.loaded.get(torrent.infoHash)
    if (existing) return existing.album

    try {
      const entry = this.toAlbum(torrent, hints)
      const { infoHash } = torrent
      this.loaded.set(infoHash, entry)
      torrent.once('close', () => this.loaded.delete(infoHash))
      return entry.album
    } catch (err) {
      torrent.destroy()
      throw err
    }
  }

  /** Applies better titles, artists and durations (e.g. archive.org tags) to a loaded album. */
  annotate(infoHash: string, info: Map<string, TrackAnnotation>): Album | undefined {
    const entry = this.loaded.get(infoHash)
    if (!entry) return undefined
    entry.album = {
      ...entry.album,
      tracks: entry.album.tracks.map(track => {
        const extra = info.get(track.key)
        if (!extra) return track
        return {
          ...track,
          title: extra.title ?? track.title,
          artist: extra.artist ?? track.artist,
          trackNo: extra.trackNo ?? track.trackNo,
          duration: extra.duration ?? track.duration
        }
      })
    }
    return entry.album
  }

  resolveFile(infoHash: string, fileIndex: number): StreamableFile | undefined {
    const entry = this.loaded.get(infoHash)
    const mime = entry?.servable.get(fileIndex)
    const file = entry?.torrent.files[fileIndex]
    if (!entry || !mime || !file) return undefined
    return {
      length: file.length,
      mime,
      createReadStream: (start, end) => file.createReadStream({ start, end })
    }
  }

  stats(): TorrentStats[] {
    return [...this.loaded.values()].map(({ torrent }) => ({
      infoHash: torrent.infoHash,
      numPeers: torrent.numPeers,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed
    }))
  }

  destroy(): Promise<void> {
    return new Promise(resolve => this.client.destroy(() => resolve()))
  }

  private toAlbum(torrent: Torrent, hints: SourceHints): LoadedTorrent {
    // Defense in depth on top of parse-torrent's normalisation: every file must land inside the cache.
    const storeDir = path.resolve(torrent.path)
    const unsafe =
      !storeDir.startsWith(this.cacheDir + path.sep) ||
      torrent.files.some(f => !path.resolve(storeDir, f.path).startsWith(storeDir + path.sep))
    if (unsafe) throw new SourceError('This torrent contains unsafe file paths and was blocked.')
    if (torrent.files.length > MAX_FILES || torrent.pieceLength > MAX_PIECE_LENGTH) {
      throw new SourceError('This torrent is too large to open.')
    }

    const library = buildLibrary(
      torrent.name,
      torrent.files.map(f => ({ path: f.path, length: f.length }))
    )
    if (library.tracks.length === 0) throw new SourceError("This torrent doesn't contain any playable audio.")
    library.tracks = library.tracks.slice(0, MAX_TRACKS)

    const base = `${this.mediaBaseUrl}/${torrent.infoHash}`
    const servable = new Map<number, string>()
    const artist = hints.artist ?? library.artist

    const tracks: Track[] = library.tracks.map(t => {
      servable.set(t.fileIndex, MIME_TYPES[t.format.toLowerCase()])
      return {
        ...t,
        id: `${torrent.infoHash}:${t.fileIndex}`,
        artist: t.artist ?? artist,
        url: `${base}/${t.fileIndex}`
      }
    })

    let coverUrl: string | undefined
    if (library.coverIndex !== undefined) {
      const coverMime = MIME_TYPES[extensionOf(torrent.files[library.coverIndex].name)]
      if (coverMime) {
        servable.set(library.coverIndex, coverMime)
        coverUrl = `${base}/${library.coverIndex}`
      }
    }

    return {
      torrent,
      servable,
      album: {
        infoHash: torrent.infoHash,
        title: hints.title ?? library.title,
        artist,
        coverUrl,
        tracks,
        totalSize: tracks.reduce((sum, t) => sum + t.size, 0)
      }
    }
  }
}

function whenReady(torrent: Torrent): Promise<void> {
  if (torrent.ready) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      torrent.removeListener('ready', onReady)
      torrent.removeListener('error', onError)
      torrent.removeListener('close', onClose)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = (err: unknown) => {
      cleanup()
      console.error('[torrent] load failed:', errorMessage(err))
      reject(new SourceError("Couldn't load this torrent. Check the link and try again."))
    }
    const onClose = () => {
      cleanup()
      reject(new SourceError('Loading this torrent was cancelled.'))
    }
    const timer = setTimeout(() => {
      cleanup()
      torrent.destroy()
      reject(new SourceError('No peers answered for this torrent. It may be dead — try another one.'))
    }, READY_TIMEOUT_MS)

    torrent.once('ready', onReady)
    torrent.once('error', onError)
    torrent.once('close', onClose)
  })
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
