// Songs by artists like one you listen to, from ListenBrainz (MetaBrainz's open listening data: free, no key). Two
// requests: LB Radio's similar artists with some of their popular recordings (ids only), then those recordings' names.
// LB Radio picks at random each time, so an answer is kept for a while: Home and the radio don't ask again, and a
// shelf doesn't change under you.

import { normalizeText, songFingerprint } from '../shared/fingerprint.ts'
import { MBID, USER_AGENT } from './genres.ts'
import { fetchJson } from './http.ts'

const API = 'https://api.listenbrainz.org/1/'
const TIMEOUT_MS = 8000
const MAX_BYTES = 2 * 1024 * 1024
/** "easy" keeps to the closest artists; popularity is a percentile of each artist's own recordings. */
const RADIO_QUERY = 'mode=easy&max_similar_artists=15&max_recordings_per_artist=4&pop_begin=50&pop_end=100'
/** Recordings this rarely played are mostly bootlegs and live takes no plugin will find. */
const MIN_LISTENS = 1000
/** Names asked for in one request. */
const MAX_RECORDINGS = 40
const KEEP_MS = 30 * 60_000
const MAX_REMEMBERED = 50

/** A song to suggest, by an artist similar to the one asked about (or by them). */
export interface SimilarSong {
  title: string
  /** The credit as released, guests included */
  artist: string
  album?: string
  /** https image URL */
  artwork?: string
  /** The MusicBrainz id of the similar artist it was picked for */
  artistMbid: string
}

export type SimilarSongs = (artistMbid: string, signal?: AbortSignal) => Promise<SimilarSong[]>

interface Recording {
  mbid: string
  artistMbid: string
}

/**
 * The recordings worth naming from an LB Radio answer (`{ artistMbid: [recording…] }`): the most played of each
 * similar artist, taken in turns so the first ones span several artists.
 */
export function recordingsFromRadio(body: unknown): Recording[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return []
  const perArtist = Object.values(body as Record<string, unknown>).map(list =>
    (Array.isArray(list) ? list : [])
      .filter(
        (r): r is { recording_mbid: string; similar_artist_mbid: string; total_listen_count: number } =>
          typeof r?.recording_mbid === 'string' &&
          MBID.test(r.recording_mbid) &&
          typeof r.similar_artist_mbid === 'string' &&
          MBID.test(r.similar_artist_mbid) &&
          Number(r.total_listen_count) >= MIN_LISTENS
      )
      .sort((a, b) => Number(b.total_listen_count) - Number(a.total_listen_count))
      .map(r => ({ mbid: r.recording_mbid, artistMbid: r.similar_artist_mbid }))
  )
  const recordings: Recording[] = []
  for (let i = 0; perArtist.some(list => i < list.length); i++) {
    for (const list of perArtist) if (i < list.length) recordings.push(list[i])
  }
  return recordings.slice(0, MAX_RECORDINGS)
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined

/** The Cover Art Archive's small front cover of a release, as the ListenBrainz charts use. */
function coverOf(release: Record<string, unknown> | undefined): string | undefined {
  const mbid = release?.caa_release_mbid
  const id = release?.caa_id
  if (typeof mbid !== 'string' || !MBID.test(mbid) || !Number.isSafeInteger(id)) return undefined
  return `https://coverartarchive.org/release/${mbid}/${id}-250.jpg`
}

/** Names the recordings from a `metadata/recording` answer, in the same order; one song once. */
export function songsFromMetadata(recordings: Recording[], body: unknown): SimilarSong[] {
  if (typeof body !== 'object' || body === null) return []
  const byId = body as Record<
    string,
    | { artist?: Record<string, unknown>; recording?: Record<string, unknown>; release?: Record<string, unknown> }
    | undefined
  >
  const seen = new Set<string>()
  const songs: SimilarSong[] = []
  for (const { mbid, artistMbid } of recordings) {
    const found = byId[mbid]
    const title = text(found?.recording?.name)
    const artist = text(found?.artist?.name)
    const key = title && artist && songFingerprint(title, artist)
    if (!title || !artist || !key || seen.has(key)) continue
    seen.add(key)
    const album = text(found?.release?.name)
    const artwork = coverOf(found?.release)
    songs.push({ title, artist, artistMbid, ...(album ? { album } : {}), ...(artwork ? { artwork } : {}) })
  }
  return songs
}

/**
 * Up to `limit` songs to suggest: none you know already (`skip`: song fingerprints), none by `skipArtist` (the artist
 * they're like, who has a shelf of their own), and at most two by one artist.
 */
export function pickSongs(
  songs: SimilarSong[],
  { skip, skipArtist, limit }: { skip: ReadonlySet<string>; skipArtist?: string; limit: number }
): SimilarSong[] {
  const perArtist = new Map<string, number>()
  const picked: SimilarSong[] = []
  for (const song of songs) {
    if (picked.length >= limit) break
    if (song.artistMbid === skipArtist) continue
    const key = songFingerprint(song.title, song.artist)
    if (key && skip.has(key)) continue
    const artist = normalizeText(song.artist)
    const count = perArtist.get(artist) ?? 0
    if (count >= 2) continue
    perArtist.set(artist, count + 1)
    picked.push(song)
  }
  return picked
}

interface Options {
  /** The parsed answer for a ListenBrainz API URL. */
  fetchBody?: (url: URL, signal?: AbortSignal) => Promise<unknown>
  now?: () => number
}

const fetchBody = (url: URL, signal?: AbortSignal): Promise<unknown> =>
  fetchJson(url, {
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    allowHost: host => host === 'api.listenbrainz.org',
    headers: { 'User-Agent': USER_AGENT },
    signal
  })

/** Songs like an artist's (by MusicBrainz id); nothing when ListenBrainz can't be reached, and that isn't kept. */
export function createSimilarSongs(options: Options = {}): SimilarSongs {
  const ask = options.fetchBody ?? fetchBody
  const now = options.now ?? Date.now
  const known = new Map<string, { at: number; songs: SimilarSong[] }>()
  const pending = new Map<string, Promise<SimilarSong[]>>()

  const load = async (artistMbid: string, signal?: AbortSignal): Promise<SimilarSong[]> => {
    const recordings = recordingsFromRadio(
      await ask(new URL(`lb-radio/artist/${artistMbid}?${RADIO_QUERY}`, API), signal)
    )
    if (recordings.length === 0) return []
    const url = new URL('metadata/recording/', API)
    url.search = new URLSearchParams({
      recording_mbids: recordings.map(r => r.mbid).join(','),
      inc: 'artist release'
    }).toString()
    return songsFromMetadata(recordings, await ask(url, signal))
  }

  return (artistMbid, signal) => {
    if (!MBID.test(artistMbid)) return Promise.resolve([])
    const cached = known.get(artistMbid)
    if (cached && now() - cached.at < KEEP_MS) return Promise.resolve(cached.songs)
    const inFlight = pending.get(artistMbid)
    if (inFlight) return inFlight

    const answer = load(artistMbid, signal).then(
      songs => {
        known.delete(artistMbid)
        known.set(artistMbid, { at: now(), songs })
        if (known.size > MAX_REMEMBERED) known.delete(known.keys().next().value as string)
        return songs
      },
      () => []
    )
    pending.set(artistMbid, answer)
    void answer.finally(() => pending.delete(artistMbid))
    return answer
  }
}
