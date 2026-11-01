// Apple Music charts: what's most played on Apple Music, plus the iTunes Store's top albums and songs overall and
// by genre, for any country. Public JSON feeds, no account or API key. Entries have no torrents: the app plays them
// by searching the user's providers (see ChartPlugin in sdk.ts).
// Feeds: rss.marketingtools.apple.com/api/v2/<cc>/music/most-played/<n>/<albums|songs>.json (Apple Music)
//        itunes.apple.com/<cc>/rss/<topalbums|topsongs>/limit=<n>[/genre=<id>]/json (iTunes Store)

import { getJson } from './lib/torrent-kit.ts'
import type { ChartEntry, ChartPlugin, Options } from './sdk.ts'

const SITE = 'Apple Music'
const LIMIT = 50
const ARTWORK_SIZE = '400x400bb.jpg'

type Feed =
  | { source: 'apple-music'; kind: 'album' | 'song' }
  | { source: 'itunes'; kind: 'album' | 'song'; genre?: number }

/** Keyed by the category ids in index.json. iTunes genre ids: https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres */
export const FEEDS: Record<string, Feed> = {
  'most-played-songs': { source: 'apple-music', kind: 'song' },
  'most-played-albums': { source: 'apple-music', kind: 'album' },
  'top-songs': { source: 'itunes', kind: 'song' },
  'top-albums': { source: 'itunes', kind: 'album' },
  pop: { source: 'itunes', kind: 'album', genre: 14 },
  'hip-hop': { source: 'itunes', kind: 'album', genre: 18 },
  rock: { source: 'itunes', kind: 'album', genre: 21 },
  alternative: { source: 'itunes', kind: 'album', genre: 20 },
  electronic: { source: 'itunes', kind: 'album', genre: 7 },
  rnb: { source: 'itunes', kind: 'album', genre: 15 },
  country: { source: 'itunes', kind: 'album', genre: 6 },
  latin: { source: 'itunes', kind: 'album', genre: 12 },
  'k-pop': { source: 'itunes', kind: 'album', genre: 51 },
  jazz: { source: 'itunes', kind: 'album', genre: 11 },
  classical: { source: 'itunes', kind: 'album', genre: 5 },
  soundtrack: { source: 'itunes', kind: 'album', genre: 16 }
}

/** Two-letter store country from the options; "us" if unset or invalid. */
export function country(options: Options): string {
  const value = typeof options.country === 'string' ? options.country.trim().toLowerCase() : ''
  return /^[a-z]{2}$/.test(value) ? value : 'us'
}

/** Apple artwork URLs end in a size ("…/100x100bb.jpg"); ask for a sharper one. */
export function biggerArtwork(url: string | undefined): string | undefined {
  if (!url?.startsWith('https://')) return undefined
  return url.replace(/\/\d+x\d+[a-z]*\.(?:jpg|png|webp)$/i, `/${ARTWORK_SIZE}`)
}

const year = (date: string | undefined): string | undefined => /^(\d{4})/.exec(date ?? '')?.[1]

export function feedUrl(feed: Feed, cc: string, limit = LIMIT): string {
  if (feed.source === 'apple-music')
    return `https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/${limit}/${feed.kind}s.json`
  const genre = feed.genre ? `/genre=${feed.genre}` : ''
  return `https://itunes.apple.com/${cc}/rss/top${feed.kind}s/limit=${limit}${genre}/json`
}

// --- Apple Music (v2 marketing feed) ---

export interface AppleMusicResult {
  name?: string
  artistName?: string
  releaseDate?: string
  artworkUrl100?: string
  genres?: Array<{ name?: string }>
}

export function parseAppleMusic(body: { feed?: { results?: AppleMusicResult[] } }, kind: Feed['kind']): ChartEntry[] {
  return (body.feed?.results ?? []).flatMap(result => {
    if (!result?.name || !result.artistName) return []
    const genre = result.genres?.find(g => g.name && g.name !== 'Music')?.name
    return [
      {
        kind,
        title: result.name,
        artist: result.artistName,
        year: year(result.releaseDate),
        artwork: biggerArtwork(result.artworkUrl100),
        tags: genre ? [genre] : undefined
      }
    ]
  })
}

// --- iTunes Store (legacy RSS as JSON: every value is wrapped in { label }) ---

interface Label {
  label?: string
}

export interface ITunesEntry {
  'im:name'?: Label
  'im:artist'?: Label
  'im:image'?: Label[]
  'im:releaseDate'?: Label
  'im:collection'?: { 'im:name'?: Label }
  category?: { attributes?: { label?: string } }
}

export function parseITunes(
  body: { feed?: { entry?: ITunesEntry | ITunesEntry[] } },
  kind: Feed['kind']
): ChartEntry[] {
  const raw = body.feed?.entry
  // A feed with a single entry has an object here instead of an array.
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : []
  return entries.flatMap(entry => {
    const title = entry?.['im:name']?.label
    const artist = entry?.['im:artist']?.label
    if (!title || !artist) return []
    const images = entry['im:image'] ?? []
    const genre = entry.category?.attributes?.label
    return [
      {
        kind,
        title,
        artist,
        album: kind === 'song' ? entry['im:collection']?.['im:name']?.label : undefined,
        year: year(entry['im:releaseDate']?.label),
        artwork: biggerArtwork(images[images.length - 1]?.label),
        tags: genre ? [genre] : undefined
      }
    ]
  })
}

async function chart(feed: Feed, options: Options, limit = LIMIT): Promise<ChartEntry[]> {
  const url = feedUrl(feed, country(options), limit)
  return feed.source === 'apple-music'
    ? parseAppleMusic(await getJson(url, SITE), feed.kind)
    : parseITunes(await getJson(url, 'the iTunes Store'), feed.kind)
}

const plugin: ChartPlugin = {
  async test({ options }) {
    const [apple, itunes] = await Promise.all([
      chart(FEEDS['most-played-songs'], options, 1),
      chart(FEEDS['top-songs'], options, 1)
    ])
    if (apple.length === 0 && itunes.length === 0)
      throw new Error(`No charts for the country “${country(options)}”. Use a two-letter code such as us, gb or in.`)
    return true
  },

  async browse({ category, options }) {
    return chart(FEEDS[category] ?? FEEDS['most-played-songs'], options)
  }
}

export default plugin
