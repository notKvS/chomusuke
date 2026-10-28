import { songFingerprint, songId } from '../shared/fingerprint.ts'
import type { SongRef } from '../shared/types.ts'
import { sanitizeThirdPartyMagnet } from './net.ts'

/** Validation shared by everything that remembers songs (ratings, playlists, backups). */

const INFO_HASH = /^[a-f0-9]{40}$/

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\p{Cc}\s]+/gu, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

export const isoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined

/** A magnet for exactly this torrent, with only public trackers / https web seeds kept. */
function cleanMagnet(value: unknown, infoHash: string): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('magnet:?')) return undefined
  const magnet = sanitizeThirdPartyMagnet(value)
  return magnet.toLowerCase().includes(`xt=urn:btih:${infoHash}`) ? magnet : undefined
}

/** Validates a song from disk, a backup file, the UI, or the engine. */
export function sanitizeSongRef(raw: unknown): SongRef | undefined {
  if (!isRecord(raw)) return undefined
  const infoHash = typeof raw.infoHash === 'string' ? raw.infoHash.toLowerCase() : ''
  const key = text(raw.key, 1024)
  const title = text(raw.title, 300)
  if (!INFO_HASH.test(infoHash) || !key || !title) return undefined
  const artist = text(raw.artist, 200)
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
    magnet: cleanMagnet(raw.magnet, infoHash) ?? `magnet:?xt=urn:btih:${infoHash}`
  }
}
