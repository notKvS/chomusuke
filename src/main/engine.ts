import { randomUUID } from 'node:crypto'
import path from 'node:path'
import WebTorrent, { type Torrent } from 'webtorrent'
import type { Album, SourceHints, TorrentDetails, TorrentStats, Track } from '../shared/types.ts'
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
/** Files listed in the details panel; the rest are only counted. */
const MAX_DETAIL_FILES = 500
const MAX_DETAIL_TRACKERS = 50

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
  /** The store folder is in the session cache (wiped on quit) rather than the library. */
  inCache: boolean
}

/** The parts of a peer connection used to stop uploading (bittorrent-protocol Wire). */
interface ChokeableWire {
  amChoking: boolean
  peerInterested: boolean
  choke(): void
  unchoke(): void
}

/** What the library needs to keep an album. */
export interface KeptTorrent {
  torrentFile: Uint8Array
  size: number
}

export interface TorrentActivity {
  /** Share of the album's audio on disk, 0-1 */
  progress: number
  uploaded: number
  numPeers: number
  uploadSpeed: number
}

const extensionOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/** Owns the WebTorrent client and maps torrents to playable albums. */
export class TorrentEngine {
  private readonly client: WebTorrent
  private readonly loaded = new Map<string, LoadedTorrent>()
  private readonly pending = new Map<string, Promise<Album>>()
  private readonly cacheDir: string
  private readonly libraryDir: string
  private readonly mediaBaseUrl: string
  private sharing = true

  /**
   * @param cacheDir session cache (streamed pieces, wiped on quit)
   * @param libraryDir where kept albums live; torrents may only store files under one of the two
   */
  constructor(cacheDir: string, mediaBaseUrl: string, libraryDir: string) {
    this.cacheDir = path.resolve(cacheDir)
    this.libraryDir = path.resolve(libraryDir)
    this.mediaBaseUrl = mediaBaseUrl
    // No UPnP / NAT-PMP: never open ports on the user's router behind their back.
    // No uTP: WebTorrent retries uTP several times before falling back to TCP, which stalls
    // for ~30s per peer on networks that drop UDP (common on corporate Wi-Fi).
    this.client = new WebTorrent({ natUpnp: false, natPmp: false, utp: false })
    this.client.on('error', (err: unknown) => console.error('[torrent] client error:', errorMessage(err)))
  }

  /** `storePath` (inside the library folder) is used for kept albums; everything else goes to the cache. */
  load(torrentId: string | Uint8Array, hints: SourceHints = {}, storePath?: string): Promise<Album> {
    if (typeof torrentId !== 'string') return this.loadNow(torrentId, hints, storePath)
    // A magnet's info hash is only known asynchronously, so de-duplicate concurrent loads here.
    let promise = this.pending.get(torrentId)
    if (!promise) {
      promise = this.loadNow(torrentId, hints).finally(() => this.pending.delete(torrentId))
      this.pending.set(torrentId, promise)
    }
    return promise
  }

  private async loadNow(torrentId: string | Uint8Array, hints: SourceHints, storePath?: string): Promise<Album> {
    let torrent: Torrent | null
    try {
      torrent = await this.client.get(torrentId as never)
    } catch {
      throw new SourceError("That isn't a valid torrent.")
    }
    if (!torrent) {
      torrent = this.client.add(torrentId as never, {
        // Our own folder per torrent: with addUID the store root would be built from the torrent's
        // unsanitised `name` field, which a hostile torrent can set to "../../somewhere".
        path: storePath ?? path.join(this.cacheDir, randomUUID()),
        addUID: false,
        // Nothing downloads until a track is actually streamed (or the album is kept).
        deselect: true,
        // Cached pieces go with the torrent; kept albums stay on disk.
        destroyStoreOnDestroy: storePath === undefined
      })
      torrent.on('wire', (wire: unknown) => this.applySharing(wire as ChokeableWire))
    }

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
      uploadSpeed: torrent.uploadSpeed,
      uploaded: torrent.uploaded
    }))
  }

  album(infoHash: string): Album | undefined {
    return this.loaded.get(infoHash)?.album
  }

  details(infoHash: string, kept: boolean): TorrentDetails | undefined {
    const entry = this.loaded.get(infoHash)
    if (!entry) return undefined
    const { torrent } = entry
    const meta = torrent as Torrent & { created?: Date; comment?: string; pieces: unknown[] }
    const playable = new Set(entry.album.tracks.map(t => t.fileIndex))
    const created = meta.created instanceof Date && !Number.isNaN(meta.created.getTime()) ? meta.created : undefined
    return {
      infoHash,
      name: torrent.name,
      magnetURI: torrent.magnetURI,
      size: torrent.length,
      pieceLength: torrent.pieceLength,
      pieceCount: meta.pieces.length,
      files: torrent.files.slice(0, MAX_DETAIL_FILES).map((file, index) => ({
        path: file.path,
        size: file.length,
        progress: file.progress,
        playable: playable.has(index)
      })),
      fileCount: torrent.files.length,
      trackers: [...new Set(torrent.announce)].slice(0, MAX_DETAIL_TRACKERS),
      numPeers: torrent.numPeers,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      createdBy: torrent.createdBy || undefined,
      comment: meta.comment || undefined,
      created: created?.toISOString(),
      kept
    }
  }

  /** What's needed to rate a track and find it again later. */
  songInfo(
    infoHash: string,
    key: string
  ):
    | {
        infoHash: string
        key: string
        title: string
        artist?: string
        album: string
        duration?: number
        magnet: string
      }
    | undefined {
    const entry = this.loaded.get(infoHash)
    const track = entry?.album.tracks.find(t => t.key === key)
    if (!entry || !track) return undefined
    return {
      infoHash,
      key,
      title: track.title,
      artist: track.artist,
      album: entry.album.title,
      duration: track.duration,
      magnet: entry.torrent.magnetURI
    }
  }

  torrentFile(infoHash: string): { name: string; data: Uint8Array } | undefined {
    const torrent = this.loaded.get(infoHash)?.torrent
    return torrent ? { name: torrent.name, data: torrent.torrentFile } : undefined
  }

  magnet(infoHash: string): string | undefined {
    return this.loaded.get(infoHash)?.torrent.magnetURI
  }

  /** Starts downloading every playable file of an album (and its cover), so it can be kept and seeded whole. */
  keep(infoHash: string): KeptTorrent | undefined {
    const entry = this.loaded.get(infoHash)
    if (!entry) return undefined
    for (const index of entry.servable.keys()) entry.torrent.files[index]?.select()
    return { torrentFile: entry.torrent.torrentFile, size: entry.album.totalSize }
  }

  activity(infoHash: string): TorrentActivity | undefined {
    const entry = this.loaded.get(infoHash)
    if (!entry) return undefined
    let have = 0
    let total = 0
    for (const track of entry.album.tracks) {
      const file = entry.torrent.files[track.fileIndex]
      have += file.downloaded
      total += file.length
    }
    const { torrent } = entry
    return {
      progress: total > 0 ? have / total : 0,
      uploaded: torrent.uploaded,
      numPeers: torrent.numPeers,
      uploadSpeed: torrent.uploadSpeed
    }
  }

  totals(): { uploaded: number; uploadSpeed: number } {
    const uploaded = [...this.loaded.values()].reduce((sum, { torrent }) => sum + torrent.uploaded, 0)
    return { uploaded, uploadSpeed: this.client.uploadSpeed }
  }

  /**
   * Sharing on: peers that want pieces get them (normal BitTorrent). Off: every peer stays choked, so nothing is
   * uploaded while downloads keep working. `uploadLimit` is bytes/s, 0 for unlimited.
   */
  setSharing(enabled: boolean, uploadLimit: number): void {
    this.sharing = enabled
    this.client.throttleUpload(uploadLimit > 0 ? uploadLimit : -1)
    for (const torrent of this.client.torrents) {
      for (const wire of torrent.wires as unknown as ChokeableWire[]) this.applySharing(wire)
    }
  }

  private applySharing(wire: ChokeableWire): void {
    if (this.sharing) {
      // Drop our no-op so the protocol's own unchoke is used again.
      if (Object.hasOwn(wire, 'unchoke')) delete (wire as Partial<ChokeableWire>).unchoke
      if (wire.peerInterested && wire.amChoking) wire.unchoke()
    } else {
      // WebTorrent unchokes interested peers by itself (and every few seconds); make that a no-op.
      wire.unchoke = () => {}
      if (!wire.amChoking) wire.choke()
    }
  }

  /** Albums streamed into the session cache this session, with what was downloaded. */
  cachedTorrents(): Array<{
    infoHash: string
    title: string
    artist?: string
    downloaded: number
    torrentFile: Uint8Array
  }> {
    return [...this.loaded.values()]
      .filter(entry => entry.inCache)
      .map(({ torrent, album }) => ({
        infoHash: torrent.infoHash,
        title: album.title,
        artist: album.artist,
        downloaded: torrent.downloaded,
        torrentFile: torrent.torrentFile
      }))
  }

  /**
   * Before quitting: closes the given albums that live in the session cache without deleting their files, and
   * returns where those files are so they can be moved into the library.
   */
  async release(infoHashes: Set<string>): Promise<Array<{ infoHash: string; storePath: string }>> {
    const released: Array<{ infoHash: string; storePath: string }> = []
    for (const [infoHash, entry] of this.loaded) {
      if (!infoHashes.has(infoHash) || !entry.inCache) continue
      const storePath = path.resolve(entry.torrent.path)
      await new Promise<void>(resolve => entry.torrent.destroy({ destroyStore: false }, () => resolve()))
      released.push({ infoHash, storePath })
    }
    return released
  }

  destroy(): Promise<void> {
    return new Promise(resolve => this.client.destroy(() => resolve()))
  }

  private toAlbum(torrent: Torrent, hints: SourceHints): LoadedTorrent {
    // Defense in depth on top of parse-torrent's normalisation: every file must land inside the cache.
    const storeDir = path.resolve(torrent.path)
    const inCache = storeDir.startsWith(this.cacheDir + path.sep)
    const unsafe =
      (!inCache && !storeDir.startsWith(this.libraryDir + path.sep)) ||
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
      inCache,
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
