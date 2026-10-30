// Backup file: liked/disliked songs, kept albums (as magnet links) and appearance settings, in one JSON file that
// can be imported into Chomusuke on another computer or OS. Everything is re-validated on import.
import type { Playlist, RatedSong } from '../shared/types.ts'
import { sanitizeThirdPartyMagnet } from './net.ts'

export const BACKUP_FORMAT = 'chomusuke-backup'
export const BACKUP_VERSION = 1
/** Backups are plain JSON; anything bigger than this isn't one of ours. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024
const MAX_APPEARANCE_CHARS = 20_000
const MAX_ALBUMS = 1000
const INFO_HASH = /^[a-f0-9]{40}$/

export interface BackupAlbum {
  infoHash: string
  title: string
  artist?: string
  magnet: string
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  app: string
  ratings: RatedSong[]
  albums: BackupAlbum[]
  playlists: Playlist[]
  appearance?: unknown
}

/** A backup that can't be read or imported; the message is shown to the user as is. */
export class BackupError extends Error {
  name = 'BackupError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\p{Cc}\s]+/gu, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

/**
 * The backup file's content, stamped with the format, version and time. Callers pass already-validated data; an
 * appearance that isn't an object or is unreasonably large is left out rather than failing the export.
 */
export function buildBackup(input: {
  app: string
  ratings: RatedSong[]
  albums: BackupAlbum[]
  playlists: Playlist[]
  appearance?: unknown
}): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: input.app,
    ratings: input.ratings,
    playlists: input.playlists,
    albums: input.albums,
    appearance: appearanceOrUndefined(input.appearance)
  }
}

function appearanceOrUndefined(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  return JSON.stringify(value).length <= MAX_APPEARANCE_CHARS ? value : undefined
}

function sanitizeAlbum(raw: unknown): BackupAlbum | undefined {
  if (!isRecord(raw)) return undefined
  const infoHash = typeof raw.infoHash === 'string' ? raw.infoHash.toLowerCase() : ''
  const title = text(raw.title, 300)
  if (!INFO_HASH.test(infoHash) || !title || typeof raw.magnet !== 'string' || raw.magnet.length > 8192)
    return undefined
  if (!raw.magnet.startsWith('magnet:?')) return undefined
  const magnet = sanitizeThirdPartyMagnet(raw.magnet)
  if (!magnet.toLowerCase().includes(`xt=urn:btih:${infoHash}`)) return undefined
  return { infoHash, title, artist: text(raw.artist, 200), magnet }
}

/** Checks a file is a Chomusuke backup; ratings and playlists stay raw (their stores validate each one). */
export function parseBackup(json: string): {
  ratings: unknown[]
  albums: BackupAlbum[]
  playlists: unknown[]
  appearance?: unknown
} {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new BackupError('That file isn’t a Chomusuke backup.')
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('That file isn’t a Chomusuke backup.')
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Chomusuke. Update the app first.')
  }
  const albums = (Array.isArray(raw.albums) ? raw.albums.slice(0, MAX_ALBUMS) : [])
    .map(sanitizeAlbum)
    .filter((album): album is BackupAlbum => album !== undefined)
  return {
    ratings: Array.isArray(raw.ratings) ? raw.ratings : [],
    playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
    albums,
    appearance: appearanceOrUndefined(raw.appearance)
  }
}
