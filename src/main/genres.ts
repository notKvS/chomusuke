// Who an artist is on MusicBrainz (their id, which ListenBrainz's similar-artist data uses) and what kind of music
// they make (the community tags): free, no key. It asks for a descriptive User-Agent and allows one request a second,
// so lookups are queued, and answers (including "unknown") are kept for the session.

import { normalizeText } from '../shared/fingerprint.ts'
import { fetchJson } from './http.ts'

const API = 'https://musicbrainz.org/ws/2/artist/'
export const USER_AGENT = 'Chomusuke/0.1 (https://github.com/notKvS/chomusuke)'
const GAP_MS = 1100
const TIMEOUT_MS = 4000
const MAX_BYTES = 512 * 1024
const MAX_REMEMBERED = 300
/** After a failed lookup, how long before the same artist is asked about again. */
const RETRY_AFTER_MS = 5 * 60_000

/** An artist on MusicBrainz: nothing (no `mbid`, no tags) when they couldn't be found for sure. */
export interface ArtistInfo {
  mbid?: string
  /** Most agreed-on first */
  tags: string[]
}

export type ArtistLookup = (artist: string, signal?: AbortSignal) => Promise<ArtistInfo>

export const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UNKNOWN: ArtistInfo = { tags: [] }

interface MusicBrainzArtist {
  id?: unknown
  name?: unknown
  score?: unknown
  tags?: unknown
}

/** The id and tag names of the artist this search answer is about; nothing if it's someone else. */
export function artistFromSearch(artist: string, body: unknown): ArtistInfo {
  const artists = (body as { artists?: unknown } | null)?.artists
  if (!Array.isArray(artists)) return UNKNOWN
  const wanted = normalizeText(artist)
  const found = (artists as MusicBrainzArtist[]).find(
    a => typeof a?.name === 'string' && normalizeText(a.name) === wanted && Number(a.score) >= 90
  )
  if (!found) return UNKNOWN
  const mbid = typeof found.id === 'string' && MBID.test(found.id) ? found.id : undefined
  const tags = Array.isArray(found.tags)
    ? (found.tags as Array<{ name?: unknown; count?: unknown }>)
        .filter(tag => typeof tag?.name === 'string' && Number(tag.count) > 0)
        .sort((a, b) => Number(b.count) - Number(a.count))
        .map(tag => String(tag.name).toLowerCase())
        .slice(0, 12)
    : []
  return mbid ? { mbid, tags } : { tags }
}

interface Lookup {
  /** The parsed answer for a MusicBrainz artist search. */
  fetchBody?: (url: URL, signal?: AbortSignal) => Promise<unknown>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const fetchBody = (url: URL, signal?: AbortSignal): Promise<unknown> =>
  fetchJson(url, {
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    allowHost: host => host === 'musicbrainz.org',
    headers: { 'User-Agent': USER_AGENT },
    signal
  })

/**
 * Looks artists up one at a time, a second apart, remembering what it learned. MusicBrainz stops answering
 * clients that go over its limit, so a failed lookup isn't repeated for a few minutes.
 */
export function createArtistLookup(lookup: Lookup = {}): ArtistLookup {
  const ask = lookup.fetchBody ?? fetchBody
  const now = lookup.now ?? Date.now
  const sleep = lookup.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const known = new Map<string, ArtistInfo>()
  const failedAt = new Map<string, number>()
  const pending = new Map<string, Promise<ArtistInfo>>()
  let last = 0
  let queue: Promise<unknown> = Promise.resolve()

  return (artist, signal) => {
    const key = normalizeText(artist)
    const cached = known.get(key)
    if (cached) return Promise.resolve(cached)
    const failed = failedAt.get(key)
    if (!key || (failed !== undefined && now() - failed < RETRY_AFTER_MS)) return Promise.resolve(UNKNOWN)
    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const answer = queue.then(async () => {
      if (signal?.aborted) return UNKNOWN
      const wait = last + GAP_MS - now()
      if (wait > 0) await sleep(wait)
      last = now()
      const url = new URL(API)
      url.search = new URLSearchParams({
        query: `artist:"${artist.replace(/["\\]/g, ' ')}"`,
        fmt: 'json',
        limit: '5'
      }).toString()
      try {
        const info = artistFromSearch(artist, await ask(url, signal))
        known.set(key, info)
        if (known.size > MAX_REMEMBERED) known.delete(known.keys().next().value as string)
        return info
      } catch {
        failedAt.set(key, now())
        return UNKNOWN
      }
    })
    // Whatever happens, the next lookup in line goes ahead.
    queue = answer
    pending.set(key, answer)
    void answer.finally(() => pending.delete(key))
    return answer
  }
}
