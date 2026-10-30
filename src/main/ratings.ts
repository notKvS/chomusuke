import { readFile, rename, writeFile } from 'node:fs/promises'
import { songId } from '../shared/fingerprint.ts'
import type { RatedSong } from '../shared/types.ts'
import { isoDate, isRecord, sanitizeSongRef } from './song-ref.ts'

/** Liked and disliked songs, kept in `<userData>/ratings.json`. */

const MAX_SONGS = 20_000
const FILE_VERSION = 1

/** Validates a rated song from disk, a backup file, or the engine. */
export function sanitizeRatedSong(raw: unknown): RatedSong | undefined {
  const song = sanitizeSongRef(raw)
  if (!song || !isRecord(raw) || (raw.rating !== 1 && raw.rating !== -1)) return undefined
  return { ...song, rating: raw.rating, ratedAt: isoDate(raw.ratedAt) ?? new Date().toISOString() }
}

/**
 * Liked and disliked songs by song id, held in memory and written after every change (temp file + rename). Invalid
 * entries in the file are dropped on load; at most 20,000 songs are kept.
 */
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
