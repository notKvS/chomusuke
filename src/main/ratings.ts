import { readFile, rename, writeFile } from 'node:fs/promises'
import { songFingerprint, songId } from '../shared/fingerprint.ts'
import type { RatedSong } from '../shared/types.ts'
import { sanitizeThirdPartyMagnet } from './net.ts'

/** Liked and disliked songs, kept in `<userData>/ratings.json`. */

const INFO_HASH = /^[a-f0-9]{40}$/
const MAX_SONGS = 20_000
const FILE_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\p{Cc}\s]+/gu, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

/** A magnet for exactly this torrent, with only public trackers / https web seeds kept. */
function cleanMagnet(value: unknown, infoHash: string): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('magnet:?')) return undefined
  const magnet = sanitizeThirdPartyMagnet(value)
  return magnet.toLowerCase().includes(`xt=urn:btih:${infoHash}`) ? magnet : undefined
}

/** Validates a rated song from disk, a backup file, or the engine. */
export function sanitizeRatedSong(raw: unknown): RatedSong | undefined {
  if (!isRecord(raw)) return undefined
  const infoHash = typeof raw.infoHash === 'string' ? raw.infoHash.toLowerCase() : ''
  const key = text(raw.key, 1024)
  const title = text(raw.title, 300)
  if (!INFO_HASH.test(infoHash) || !key || !title || (raw.rating !== 1 && raw.rating !== -1)) return undefined
  const artist = text(raw.artist, 200)
  const ratedAt = typeof raw.ratedAt === 'string' && !Number.isNaN(Date.parse(raw.ratedAt)) ? raw.ratedAt : undefined
  const duration =
    typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : undefined
  return {
    id: songId(infoHash, key),
    infoHash,
    key,
    title,
    artist,
    album: text(raw.album, 300),
    duration,
    fingerprint: songFingerprint(title, artist),
    magnet: cleanMagnet(raw.magnet, infoHash) ?? `magnet:?xt=urn:btih:${infoHash}`,
    rating: raw.rating,
    ratedAt: ratedAt ?? new Date().toISOString()
  }
}

export class RatingsStore {
  private readonly file: string
  private readonly songs = new Map<string, RatedSong>()

  constructor(file: string) {
    this.file = file
  }

  async load(): Promise<void> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      return
    }
    const list = isRecord(raw) && Array.isArray(raw.songs) ? raw.songs : []
    for (const item of list.slice(0, MAX_SONGS)) {
      const song = sanitizeRatedSong(item)
      if (song) this.songs.set(song.id, song)
    }
  }

  /** Most recently rated first. */
  list(): RatedSong[] {
    return [...this.songs.values()].sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))
  }

  /** Rates a song (1 like, -1 dislike) or clears its rating (0). */
  async set(raw: unknown, rating: 0 | 1 | -1): Promise<void> {
    if (rating === 0) {
      const id =
        isRecord(raw) && typeof raw.infoHash === 'string' && typeof raw.key === 'string'
          ? songId(raw.infoHash, raw.key)
          : ''
      this.songs.delete(id)
    } else {
      const song = sanitizeRatedSong({ ...(isRecord(raw) ? raw : {}), rating, ratedAt: new Date().toISOString() })
      if (!song) throw new Error('That song can’t be rated.')
      if (!this.songs.has(song.id) && this.songs.size >= MAX_SONGS) throw new Error('Too many rated songs.')
      this.songs.set(song.id, song)
    }
    await this.persist()
  }

  /** Merges songs from a backup: per song, the most recent rating wins. Returns how many changed. */
  async merge(list: unknown[]): Promise<number> {
    let changed = 0
    for (const item of list.slice(0, MAX_SONGS)) {
      const song = sanitizeRatedSong(item)
      if (!song) continue
      const current = this.songs.get(song.id)
      if (current && current.ratedAt >= song.ratedAt) continue
      if (!current && this.songs.size >= MAX_SONGS) break
      this.songs.set(song.id, song)
      changed++
    }
    if (changed) await this.persist()
    return changed
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify({ version: FILE_VERSION, songs: this.list() }, null, 2)
    await writeFile(`${this.file}.tmp`, body, { encoding: 'utf8', mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
}
