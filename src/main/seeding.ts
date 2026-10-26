import type { Dirent } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SharingSettings } from '../shared/types.ts'

/**
 * Music this app keeps on disk and seeds, so listeners share with each other. Two kinds of album:
 *   kept      the user pressed "Keep & seed": downloaded in full, never evicted
 *   streamed  played this or an earlier session: whatever pieces were streamed, kept within a size cap
 *             (least recently played go first) and only while the user hasn't opted out
 * Layout under `dir`:
 *   library.json            sharing settings + both lists
 *   torrents/<hash>.torrent each album's torrent metadata
 *   data/<hash>/            each album's files (the torrent's store folder)
 * Albums are downloaded into the session cache first and moved here on quit.
 */

export interface LibraryEntry {
  infoHash: string
  title: string
  artist?: string
  /** https artwork only; loopback URLs from the stream server don't survive a restart */
  coverUrl?: string
  /** Bytes: the album's audio for kept albums, what's on disk for streamed ones */
  size: number
  /** When it was kept, or for streamed albums when it was last played */
  addedAt: string
}

export const DEFAULT_SHARING: SharingSettings = {
  enabled: true,
  seedLibrary: true,
  seedStreamed: true,
  streamCacheGB: 2,
  uploadLimitKBps: 0
}
/** Upload limits offered in the UI, KB/s (0 = unlimited). */
export const UPLOAD_LIMITS = [0, 64, 128, 256, 512, 1024, 2048, 5120]
/** Space for streamed music offered in the UI, GB. */
export const STREAM_CACHE_SIZES = [1, 2, 5, 10, 20]

const INFO_HASH = /^[a-f0-9]{40}$/
const FILE_VERSION = 1
const MAX_ENTRIES = 1000
const GB = 1024 ** 3

/** User-facing validation error. */
export class LibraryError extends Error {
  name = 'LibraryError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isInfoHash = (value: unknown): value is string => typeof value === 'string' && INFO_HASH.test(value)

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\p{Cc}\s]+/gu, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const pickBool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const pickFrom = (options: number[], value: unknown, fallback: number) =>
  typeof value === 'number' && options.includes(value) ? value : fallback

export function sanitizeSharing(raw: unknown, fallback: SharingSettings = DEFAULT_SHARING): SharingSettings {
  const v = isRecord(raw) ? raw : {}
  return {
    enabled: pickBool(v.enabled, fallback.enabled),
    seedLibrary: pickBool(v.seedLibrary, fallback.seedLibrary),
    seedStreamed: pickBool(v.seedStreamed, fallback.seedStreamed),
    streamCacheGB: pickFrom(STREAM_CACHE_SIZES, v.streamCacheGB, fallback.streamCacheGB),
    uploadLimitKBps: pickFrom(UPLOAD_LIMITS, v.uploadLimitKBps, fallback.uploadLimitKBps)
  }
}

/** Validates an album being kept or recorded (or a saved entry being reloaded). */
export function sanitizeEntry(raw: unknown): LibraryEntry | undefined {
  if (!isRecord(raw) || !isInfoHash(raw.infoHash)) return undefined
  const size = typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : 0
  const addedAt = typeof raw.addedAt === 'string' && !Number.isNaN(Date.parse(raw.addedAt)) ? raw.addedAt : undefined
  return {
    infoHash: raw.infoHash,
    title: text(raw.title, 300) ?? 'Untitled album',
    artist: text(raw.artist, 200),
    coverUrl: httpsUrl(raw.coverUrl),
    size,
    addedAt: addedAt ?? new Date().toISOString()
  }
}

/** Bytes used by a folder, recursively; 0 if it doesn't exist. */
export async function folderSize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await folderSize(full)
    else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

const newestFirst = (a: LibraryEntry, b: LibraryEntry) => b.addedAt.localeCompare(a.addedAt)

export class SeedLibrary {
  private readonly dir: string
  private readonly kept = new Map<string, LibraryEntry>()
  private readonly streamed = new Map<string, LibraryEntry>()
  private settings: SharingSettings = DEFAULT_SHARING
  /** Albums dropped this session; their files are deleted on quit, once nothing has them open. */
  private readonly removed = new Set<string>()

  constructor(dir: string) {
    this.dir = path.resolve(dir)
  }

  get dataDir(): string {
    return path.join(this.dir, 'data')
  }

  get sharing(): SharingSettings {
    return this.settings
  }

  /** Store folder for an album's files. */
  dataPath(infoHash: string): string {
    if (!isInfoHash(infoHash)) throw new LibraryError('Invalid album id.')
    return path.join(this.dataDir, infoHash)
  }

  private torrentPath(infoHash: string): string {
    return path.join(this.dir, 'torrents', `${infoHash}.torrent`)
  }

  async load(): Promise<void> {
    await mkdir(path.join(this.dir, 'torrents'), { recursive: true })
    await mkdir(this.dataDir, { recursive: true })
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path.join(this.dir, 'library.json'), 'utf8'))
    } catch {
      return
    }
    if (!isRecord(raw)) return
    this.settings = sanitizeSharing(raw.sharing)
    for (const [list, target] of [
      [raw.albums, this.kept],
      [raw.streamed, this.streamed]
    ] as const) {
      for (const item of Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : []) {
        const entry = sanitizeEntry(item)
        if (entry && !this.kept.has(entry.infoHash)) target.set(entry.infoHash, entry)
      }
    }
  }

  /** Kept albums, newest first. */
  list(): LibraryEntry[] {
    return [...this.kept.values()].sort(newestFirst)
  }

  /** Streamed albums, most recently played first. */
  listStreamed(): LibraryEntry[] {
    return [...this.streamed.values()].sort(newestFirst)
  }

  /** Kept (not streamed) */
  has(infoHash: string): boolean {
    return this.kept.has(infoHash)
  }

  get(infoHash: string): LibraryEntry | undefined {
    return this.kept.get(infoHash) ?? this.streamed.get(infoHash)
  }

  /** Keeps an album (also promotes a streamed one). */
  async add(raw: unknown, torrentFile: Uint8Array): Promise<LibraryEntry> {
    const entry = sanitizeEntry(raw)
    if (!entry) throw new LibraryError('That album can’t be kept.')
    if (!this.kept.has(entry.infoHash) && this.kept.size >= MAX_ENTRIES) {
      throw new LibraryError('Your library is full.')
    }
    await writeFile(this.torrentPath(entry.infoHash), torrentFile)
    this.streamed.delete(entry.infoHash)
    this.kept.set(entry.infoHash, { ...this.kept.get(entry.infoHash), ...entry })
    this.removed.delete(entry.infoHash)
    await this.persist()
    return entry
  }

  /** Remembers an album streamed this session (on quit), so its pieces keep being seeded. */
  async recordStreamed(raw: unknown, torrentFile: Uint8Array): Promise<void> {
    const entry = sanitizeEntry(raw)
    // Not if it's kept anyway, or the user dropped it this session.
    if (!entry || this.kept.has(entry.infoHash) || this.removed.has(entry.infoHash)) return
    if (!this.streamed.has(entry.infoHash) && this.streamed.size >= MAX_ENTRIES) return
    await writeFile(this.torrentPath(entry.infoHash), torrentFile)
    this.streamed.set(entry.infoHash, entry)
    await this.persist()
  }

  /** Marks a streamed album as just played (it's evicted last). */
  async touch(infoHash: string): Promise<void> {
    const entry = this.streamed.get(infoHash)
    if (!entry) return
    entry.addedAt = new Date().toISOString()
    await this.persist()
  }

  /** Drops a kept or streamed album; its files are deleted on quit. */
  async remove(infoHash: string): Promise<void> {
    if (!this.kept.delete(infoHash) && !this.streamed.delete(infoHash)) {
      throw new LibraryError('That album isn’t in your library.')
    }
    this.removed.add(infoHash)
    await rm(this.torrentPath(infoHash), { force: true })
    await this.persist()
  }

  async clearStreamed(): Promise<void> {
    for (const infoHash of this.streamed.keys()) {
      this.removed.add(infoHash)
      await rm(this.torrentPath(infoHash), { force: true })
    }
    this.streamed.clear()
    await this.persist()
  }

  /**
   * Re-measures streamed albums on disk and drops the least recently played until they fit the cap.
   * Returns the bytes kept.
   */
  async enforceStreamCap(cap = this.settings.streamCacheGB * GB): Promise<number> {
    let used = 0
    for (const entry of this.listStreamed()) {
      entry.size = await folderSize(this.dataPath(entry.infoHash))
      if (entry.size > 0 && used + entry.size <= cap) {
        used += entry.size
        continue
      }
      this.streamed.delete(entry.infoHash)
      this.removed.add(entry.infoHash)
      await rm(this.torrentPath(entry.infoHash), { force: true })
    }
    await this.persist()
    return used
  }

  async readTorrent(infoHash: string): Promise<Buffer> {
    if (!this.get(infoHash)) throw new LibraryError('That album isn’t in your library.')
    return readFile(this.torrentPath(infoHash))
  }

  async setSharing(raw: unknown): Promise<SharingSettings> {
    this.settings = sanitizeSharing(raw, this.settings)
    await this.persist()
    return this.settings
  }

  /** Moves an album's files from the session cache into the library (on quit). */
  async adopt(infoHash: string, fromDir: string): Promise<void> {
    if (!this.get(infoHash)) return
    const target = this.dataPath(infoHash)
    await rm(target, { recursive: true, force: true })
    try {
      await rename(fromDir, target)
    } catch {
      // Cache and library on different drives: copy instead.
      await cp(fromDir, target, { recursive: true })
    }
  }

  /** Deletes the files of dropped albums and any folder no entry owns (e.g. left by a crash). */
  async purge(): Promise<void> {
    let folders: string[] = []
    try {
      folders = await readdir(this.dataDir)
    } catch {
      return
    }
    for (const name of folders) {
      if (this.get(name) && !this.removed.has(name)) continue
      await rm(path.join(this.dataDir, name), { recursive: true, force: true }).catch(() => {})
    }
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify(
      { version: FILE_VERSION, sharing: this.settings, albums: this.list(), streamed: this.listStreamed() },
      null,
      2
    )
    const file = path.join(this.dir, 'library.json')
    await writeFile(`${file}.tmp`, body, { encoding: 'utf8', mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }
}
