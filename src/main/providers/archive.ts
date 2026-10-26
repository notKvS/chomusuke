import type { TrackAnnotation } from '../engine.ts'
import { isAudioFileName, titleFromFileName, trackKey } from '../library.ts'
import type { MusicProvider, ProviderAlbum, ProviderResults, ProviderSong } from './types.ts'

/**
 * Internet Archive provider: every item there ships a .torrent with HTTP web seeds, and its catalogue
 * (live music, netlabels, 78s, LPs, CC releases) is freely shareable.
 */

/** GETs and parses JSON from an archive.org URL; injected so the search logic is testable offline. */
export type JsonFetcher = (url: URL, maxBytes: number, signal?: AbortSignal) => Promise<unknown>

export interface ArchiveTrackInfo {
  key: string
  name: string
  title: string
  artist?: string
  album?: string
  trackNo?: number
  duration?: number
}

const ARCHIVE_ORIGIN = 'https://archive.org'
const EXCLUDED_COLLECTIONS = [
  'librivoxaudio',
  'podcasts',
  'podcasts_mirror',
  'audio_podcast',
  'radioprograms',
  'oldtimeradio',
  'audio_bookspoetry',
  'audio_religion',
  'audio_news',
  'audio_tech'
]
// Music only: plain audio items plus the Live Music Archive (mediatype etree); skip stream-only items.
const FILTER = `mediatype:(audio OR etree) AND -access-restricted-item:(true) AND -collection:(${EXCLUDED_COLLECTIONS.join(' OR ')})`
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const MAX_TOKENS = 8
const ALBUM_ROWS = 24
const PARTIAL_ROWS = 4
const SONG_SOURCE_ITEMS = 8
const MAX_SONGS = 12
const MAX_SONGS_PER_ALBUM = 3
const SEARCH_MAX_BYTES = 2 * 1024 * 1024
const FILES_MAX_BYTES = 8 * 1024 * 1024
/** Song lookups that haven't answered by then are skipped so results stay snappy. */
const SONG_LOOKUP_BUDGET_MS = 4000
const MAX_TEXT = 200
const LOW_BITRATE = /_(?:32|48|64|96)kbp?s?\.[a-z0-9]+$/i
/** Too common to say anything about which song was meant; still required to match, just not scored. */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'by',
  'de',
  'el',
  'feat',
  'for',
  'in',
  'la',
  'le',
  'live',
  'of',
  'on',
  'the',
  'to'
])

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const isArchiveHost = (hostname: string): boolean =>
  hostname === 'archive.org' || hostname.endsWith('.archive.org')

/** Lower-case, accent-free, punctuation-free text for matching. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Query words; only letters and digits survive, so nothing can inject Lucene syntax. */
export function tokenize(query: string): string[] {
  return [...new Set(normalizeText(query).split(' ').filter(Boolean))].slice(0, MAX_TOKENS)
}

const inTitleOrCreator = (tokens: string[]): string => tokens.map(t => `(title:(${t}) OR creator:(${t}))`).join(' AND ')

/**
 * strict: every word in an item's title or creator (album/artist queries).
 * partial: the same minus the first or last word, so "artist song" still finds the artist's albums.
 * broad: every word anywhere, including descriptions that often hold track lists.
 */
export function buildQueries(tokens: string[]): { strict: string; broad: string; partial: string[] } {
  const subsets = tokens.length > 1 ? [tokens.slice(0, -1), tokens.slice(1)] : []
  return {
    strict: `${inTitleOrCreator(tokens)} AND ${FILTER}`,
    broad: `(${tokens.join(' AND ')}) AND ${FILTER}`,
    partial: subsets.map(subset => `${inTitleOrCreator(subset)} AND ${FILTER}`)
  }
}

export function searchUrl(query: string, rows: number, sort = 'downloads desc'): URL {
  const url = new URL('/advancedsearch.php', ARCHIVE_ORIGIN)
  url.searchParams.set('q', query)
  for (const field of ['identifier', 'title', 'creator', 'year', 'date', 'downloads', 'licenseurl']) {
    url.searchParams.append('fl[]', field)
  }
  url.searchParams.append('sort[]', sort)
  url.searchParams.set('rows', String(rows))
  url.searchParams.set('output', 'json')
  return url
}

export const filesUrl = (id: string): URL => new URL(`/metadata/${encodeURIComponent(id)}/files`, ARCHIVE_ORIGIN)

/** The item id when `url` is an archive.org item torrent, e.g. https://archive.org/download/x/x_archive.torrent */
export function archiveIdFromTorrentUrl(url: string): string | undefined {
  const match = /^https:\/\/archive\.org\/download\/([^/?#]+)\/([^/?#]+)_archive\.torrent$/.exec(url)
  if (!match || match[1] !== match[2] || !IDENTIFIER.test(match[1])) return undefined
  return match[1]
}

function text(value: unknown, join = false): string | undefined {
  const raw = Array.isArray(value)
    ? value
        .filter(v => typeof v === 'string')
        .slice(0, join ? 3 : 1)
        .join(', ')
    : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const clean = String(raw).replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, MAX_TEXT) : undefined
}

export function licenseLabel(url: string | undefined): string | undefined {
  if (!url) return undefined
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\//i.exec(url)
  if (cc) return `CC ${cc[1].toUpperCase()}`
  if (/publicdomain\/zero/i.test(url)) return 'CC0'
  if (/publicdomain\/mark/i.test(url)) return 'Public domain'
  return undefined
}

/** "01:25" → 85, "1:02:03" → 3723, "85.3" → 85.3 */
export function parseLength(value: unknown): number | undefined {
  const raw = text(value)
  if (!raw) return undefined
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(raw)) return undefined
  return raw.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

export const torrentUrlFor = (id: string): string => `${ARCHIVE_ORIGIN}/download/${id}/${id}_archive.torrent`
export const artworkUrlFor = (id: string): string => `${ARCHIVE_ORIGIN}/services/img/${id}`

/** Albums from an advancedsearch response; `ref` is the archive.org identifier. */
export function parseAlbums(json: unknown): ProviderAlbum[] {
  if (!isRecord(json) || !isRecord(json.response) || !Array.isArray(json.response.docs)) {
    throw new Error('Unexpected search response')
  }
  const albums: ProviderAlbum[] = []
  for (const doc of json.response.docs) {
    if (!isRecord(doc) || typeof doc.identifier !== 'string' || !IDENTIFIER.test(doc.identifier)) continue
    const id = doc.identifier
    albums.push({
      ref: id,
      title: text(doc.title) ?? id,
      artist: text(doc.creator, true),
      year: /^\d{4}/.exec(text(doc.year) ?? text(doc.date) ?? '')?.[0],
      license: licenseLabel(text(doc.licenseurl)),
      artwork: artworkUrlFor(id)
    })
  }
  return albums
}

/** One entry per song from an item's /metadata/<id>/files listing, preferring files with tag metadata. */
export function parseArchiveFiles(json: unknown): ArchiveTrackInfo[] {
  const files = isRecord(json) && Array.isArray(json.result) ? json.result : []
  const best = new Map<string, { file: Record<string, unknown>; name: string; rank: number }>()
  for (const file of files) {
    if (!isRecord(file) || typeof file.name !== 'string') continue
    const name = file.name
    if (name.split('/').some(part => part.startsWith('.') || part === '__MACOSX') || !isAudioFileName(name)) continue
    const rank = (text(file.title) ? 2 : 0) - (LOW_BITRATE.test(name) ? 1 : 0)
    const key = trackKey(name)
    const current = best.get(key)
    if (!current || rank > current.rank) best.set(key, { file, name, rank })
  }
  return [...best.entries()]
    .sort(([, a], [, b]) => naturalCompare(a.name, b.name))
    .map(([key, { file, name }]) => {
      const trackNo = Number.parseInt(text(file.track) ?? '', 10)
      return {
        key,
        name,
        title: text(file.title) ?? titleFromFileName(name),
        artist: text(file.creator, true),
        album: text(file.album),
        trackNo: Number.isFinite(trackNo) && trackNo > 0 ? trackNo : undefined,
        duration: parseLength(file.length)
      }
    })
}

export interface PickedSong {
  song: ProviderSong
  /** Query words found in the song title */
  titleHits: number
  /** Every query word is in the song's own title or artist (not just its album's title) */
  direct: boolean
}

/** Songs of one item that match every query word. */
export function pickSongs(album: ProviderAlbum, filesJson: unknown, tokens: string[]): PickedSong[] {
  const hits = (words: string[], token: string) => words.some(word => word.startsWith(token))
  const picked: PickedSong[] = []
  for (const info of parseArchiveFiles(filesJson)) {
    const artist = info.artist ?? album.artist
    const titleWords = normalizeText(info.title).split(' ')
    const songWords = normalizeText(`${info.title} ${artist ?? ''}`).split(' ')
    const allWords = normalizeText(`${info.title} ${artist ?? ''} ${info.album ?? ''} ${album.title}`).split(' ')
    if (!tokens.every(token => hits(allWords, token))) continue
    picked.push({
      titleHits: tokens.filter(token => !STOPWORDS.has(token) && hits(titleWords, token)).length,
      direct: tokens.every(token => hits(songWords, token)),
      song: { key: info.key, title: info.title, artist, duration: info.duration, album }
    })
  }
  return picked
}

/** Like Promise.allSettled, but anything still pending after `ms` counts as rejected. */
function settleWithin<T>(promises: Promise<T>[], ms: number): Promise<PromiseSettledResult<T>[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), ms)
  })
  return Promise.allSettled(promises.map(p => Promise.race([p, deadline]))).finally(() => clearTimeout(timer))
}

function uniqueById<T>(items: T[], idOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const id = idOf(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export async function searchArchive(query: string, fetchJson: JsonFetcher): Promise<ProviderResults> {
  const tokens = tokenize(query)
  if (tokens.length === 0) return { songs: [], albums: [] }

  const queries = buildQueries(tokens)
  const run = async (q: string, rows: number) => parseAlbums(await fetchJson(searchUrl(q, rows), SEARCH_MAX_BYTES))
  const [strict, broad, ...partials] = await Promise.allSettled([
    run(queries.strict, ALBUM_ROWS),
    run(queries.broad, ALBUM_ROWS),
    ...queries.partial.map(q => run(q, PARTIAL_ROWS))
  ])
  if (strict.status === 'rejected' && broad.status === 'rejected') throw strict.reason
  const value = (result: PromiseSettledResult<ProviderAlbum[]>) => (result.status === 'fulfilled' ? result.value : [])

  // Look inside the most relevant items for matching songs; lower tier = stronger match.
  const sources = uniqueById(
    [
      ...value(strict)
        .slice(0, 4)
        .map(album => ({ album, tier: 0 })),
      ...partials.flatMap(value).map(album => ({ album, tier: 1 })),
      ...value(broad)
        .slice(0, 3)
        .map(album => ({ album, tier: 2 }))
    ],
    s => s.album.ref
  ).slice(0, SONG_SOURCE_ITEMS)
  const fileLists = await settleWithin(
    sources.map(s => fetchJson(filesUrl(s.album.ref), FILES_MAX_BYTES)),
    SONG_LOOKUP_BUDGET_MS
  )

  let scored: Array<{ song: ProviderSong; score: number; direct: boolean }> = []
  sources.forEach(({ album, tier }, rank) => {
    const list = fileLists[rank]
    if (list.status !== 'fulfilled') return
    pickSongs(album, list.value, tokens).forEach(({ song, titleHits, direct }, order) => {
      scored.push({ song, direct, score: titleHits * 10 - tier * 3 - rank * 0.5 - order * 0.001 })
    })
  })
  // Prefer songs matched by their own title/artist over ones that only matched via the album name.
  if (scored.some(s => s.direct)) scored = scored.filter(s => s.direct)
  scored.sort((a, b) => b.score - a.score)

  const perAlbum = new Map<string, number>()
  const seenSongs = new Set<string>() // the same release is often uploaded more than once
  const songs: ProviderSong[] = []
  for (const { song } of scored) {
    const count = perAlbum.get(song.album.ref) ?? 0
    const identity = `${normalizeText(song.title)}|${normalizeText(song.artist ?? '')}`
    if (count >= MAX_SONGS_PER_ALBUM || seenSongs.has(identity)) continue
    seenSongs.add(identity)
    perAlbum.set(song.album.ref, count + 1)
    songs.push(song)
    if (songs.length === MAX_SONGS) break
  }

  // Partial matches only earn an album slot when they actually contain a matching song.
  const albums = uniqueById([...value(strict), ...songs.map(s => s.album), ...value(broad)], a => a.ref).slice(
    0,
    ALBUM_ROWS
  )
  return { songs, albums }
}

/** Tag-derived titles, artists and durations for an item's tracks, keyed by trackKey(). */
export async function fetchArchiveTrackInfo(
  id: string,
  fetchJson: JsonFetcher
): Promise<Map<string, ArchiveTrackInfo>> {
  const files = parseArchiveFiles(await fetchJson(filesUrl(id), FILES_MAX_BYTES))
  return new Map(files.map(info => [info.key, info]))
}

/** Explore categories: collections/subjects, ranked by downloads in the last week. */
export const ARCHIVE_CATEGORIES = [
  { id: 'trending', name: 'Trending this week', query: 'collection:(audio_music OR etree OR netlabels)' },
  { id: 'live', name: 'Live concerts', query: 'collection:(etree)' },
  { id: 'netlabels', name: 'Netlabels', query: 'collection:(netlabels)' },
  { id: '78rpm', name: '78 RPM records', query: 'collection:(78rpm)' },
  { id: 'classical', name: 'Classical', query: 'subject:(classical)' },
  { id: 'jazz', name: 'Jazz', query: 'subject:(jazz)' }
] as const

export async function browseArchive(categoryId: string, fetchJson: JsonFetcher): Promise<ProviderResults> {
  const category = ARCHIVE_CATEGORIES.find(c => c.id === categoryId)
  if (!category) throw new Error('Unknown category')
  const json = await fetchJson(searchUrl(`${category.query} AND ${FILTER}`, ALBUM_ROWS, 'week desc'), SEARCH_MAX_BYTES)
  return { albums: parseAlbums(json), songs: [] }
}

/** Tag-derived track details for an archive.org item torrent URL, or null when it isn't one / the lookup fails. */
export async function annotationsForTorrentUrl(
  url: string,
  fetchJson: JsonFetcher
): Promise<Map<string, TrackAnnotation> | null> {
  const id = archiveIdFromTorrentUrl(url)
  if (!id) return null
  return fetchArchiveTrackInfo(id, fetchJson).catch(() => null)
}

export function createArchiveProvider(deps: {
  fetchJson: JsonFetcher
  fetchTorrent: (url: string, signal?: AbortSignal) => Promise<Uint8Array>
}): MusicProvider {
  return {
    id: 'archive',
    name: 'Internet Archive',
    layout: 'cards',
    search: (query, signal) => searchArchive(query, (url, maxBytes) => deps.fetchJson(url, maxBytes, signal)),
    categories: ARCHIVE_CATEGORIES.map(({ id, name }) => ({ id, name })),
    browse: (categoryId, signal) => browseArchive(categoryId, (url, maxBytes) => deps.fetchJson(url, maxBytes, signal)),
    async open(album, signal) {
      if (!IDENTIFIER.test(album.ref)) throw new Error('Invalid archive.org identifier')
      // Fetch tags in parallel with the torrent; they only improve titles, so failures are ignored.
      const annotations = fetchArchiveTrackInfo(album.ref, deps.fetchJson).catch(() => null)
      return {
        kind: 'torrent',
        torrent: await deps.fetchTorrent(torrentUrlFor(album.ref), signal),
        hints: { title: album.title, artist: album.artist },
        annotations
      }
    }
  }
}
