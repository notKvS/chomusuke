import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Playlist, PlaylistSong } from '../shared/types.ts'
import { isoDate, isRecord, sanitizeSongRef, text } from './song-ref.ts'

/**
 * User playlists, kept in `<userData>/playlists.json`. A playlist can mix songs from any torrent and any source;
 * each entry stores enough (torrent magnet + file key) to load and play it again.
 */

const MAX_PLAYLISTS = 500
const MAX_SONGS_PER_PLAYLIST = 5000
const FILE_VERSION = 1
const ID = /^[a-f0-9-]{36}$/

export class PlaylistError extends Error {
  name = 'PlaylistError'
}

export function sanitizeName(raw: unknown): string {
  const name = text(raw, 100)
  if (!name) throw new PlaylistError('Give the playlist a name.')
  return name
}

function sanitizeSong(raw: unknown): PlaylistSong | undefined {
  const song = sanitizeSongRef(raw)
  if (!song) return undefined
  return { ...song, addedAt: (isRecord(raw) && isoDate(raw.addedAt)) || new Date().toISOString() }
}

/** Validates a playlist from disk or a backup. Duplicate songs are dropped. */
export function sanitizePlaylist(raw: unknown): Playlist | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id)) return undefined
  const name = text(raw.name, 100)
  if (!name) return undefined
  const seen = new Set<string>()
  const songs: PlaylistSong[] = []
  for (const item of Array.isArray(raw.songs) ? raw.songs.slice(0, MAX_SONGS_PER_PLAYLIST) : []) {
    const song = sanitizeSong(item)
    if (song && !seen.has(song.id)) {
      seen.add(song.id)
      songs.push(song)
    }
  }
  const now = new Date().toISOString()
  return {
    id: raw.id,
    name,
    createdAt: isoDate(raw.createdAt) ?? now,
    updatedAt: isoDate(raw.updatedAt) ?? now,
    songs
  }
}

/**
 * The playlists file, held in memory. Every change validates its input (ids, names, songs come from the renderer or
 * a backup), throws {@link PlaylistError} with a user-facing message, and is written straight away through a temp file
 * and rename, so a crash never leaves half a file. Capped at 500 playlists of 5000 songs.
 */
export class PlaylistStore {
  private readonly file: string
  private playlists: Playlist[] = []

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
    const list = isRecord(raw) && Array.isArray(raw.playlists) ? raw.playlists : []
    const seen = new Set<string>()
    for (const item of list.slice(0, MAX_PLAYLISTS)) {
      const playlist = sanitizePlaylist(item)
      if (playlist && !seen.has(playlist.id)) {
        seen.add(playlist.id)
        this.playlists.push(playlist)
      }
    }
  }

  list(): Playlist[] {
    return this.playlists
  }

  private get(id: unknown): Playlist {
    const playlist = this.playlists.find(p => p.id === id)
    if (!playlist) throw new PlaylistError('That playlist no longer exists.')
    return playlist
  }

  private touch(playlist: Playlist): void {
    playlist.updatedAt = new Date().toISOString()
  }

  async create(name: unknown): Promise<Playlist> {
    if (this.playlists.length >= MAX_PLAYLISTS) throw new PlaylistError('That’s a lot of playlists already.')
    const now = new Date().toISOString()
    const playlist: Playlist = { id: randomUUID(), name: sanitizeName(name), createdAt: now, updatedAt: now, songs: [] }
    this.playlists.push(playlist)
    await this.persist()
    return playlist
  }

  async rename(id: unknown, name: unknown): Promise<void> {
    const playlist = this.get(id)
    playlist.name = sanitizeName(name)
    this.touch(playlist)
    await this.persist()
  }

  async remove(id: unknown): Promise<void> {
    this.get(id)
    this.playlists = this.playlists.filter(p => p.id !== id)
    await this.persist()
  }

  /** Appends songs that aren't in the playlist yet; returns how many were added. */
  async add(id: unknown, songs: unknown[]): Promise<number> {
    const playlist = this.get(id)
    const present = new Set(playlist.songs.map(s => s.id))
    let added = 0
    for (const raw of songs) {
      const song = sanitizeSong({ ...(isRecord(raw) ? raw : {}), addedAt: new Date().toISOString() })
      if (!song || present.has(song.id)) continue
      if (playlist.songs.length >= MAX_SONGS_PER_PLAYLIST) throw new PlaylistError('That playlist is full.')
      playlist.songs.push(song)
      present.add(song.id)
      added++
    }
    if (added) {
      this.touch(playlist)
      await this.persist()
    }
    return added
  }

  async removeSong(id: unknown, songId: unknown): Promise<void> {
    const playlist = this.get(id)
    playlist.songs = playlist.songs.filter(s => s.id !== songId)
    this.touch(playlist)
    await this.persist()
  }

  async move(id: unknown, from: unknown, to: unknown): Promise<void> {
    const playlist = this.get(id)
    const n = playlist.songs.length
    if (!Number.isInteger(from) || !Number.isInteger(to)) return
    const a = from as number
    const b = to as number
    if (a < 0 || a >= n || b < 0 || b >= n || a === b) return
    const [song] = playlist.songs.splice(a, 1)
    playlist.songs.splice(b, 0, song)
    this.touch(playlist)
    await this.persist()
  }

  /** Merges playlists from a backup: same id → the most recently changed wins; new ones are added. */
  async merge(list: unknown[]): Promise<number> {
    let changed = 0
    for (const item of list.slice(0, MAX_PLAYLISTS)) {
      const incoming = sanitizePlaylist(item)
      if (!incoming) continue
      const index = this.playlists.findIndex(p => p.id === incoming.id)
      if (index >= 0) {
        if (this.playlists[index].updatedAt >= incoming.updatedAt) continue
        this.playlists[index] = incoming
      } else {
        if (this.playlists.length >= MAX_PLAYLISTS) break
        this.playlists.push(incoming)
      }
      changed++
    }
    if (changed) await this.persist()
    return changed
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify({ version: FILE_VERSION, playlists: this.playlists }, null, 2)
    await writeFile(`${this.file}.tmp`, body, { encoding: 'utf8', mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
}
