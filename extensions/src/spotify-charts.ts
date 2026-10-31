// Spotify charts: Spotify's own weekly global top songs and albums (the public feed behind charts.spotify.com, no
// login), plus daily and weekly top songs for any country from kworb.net, which republishes every Spotify country
// chart as plain HTML. Entries have no torrents: the app plays them by searching the user's torrent sources.
// Feeds: https://charts-spotify-com-service.spotify.com/public/v0/charts (global weekly, JSON)
//        https://kworb.net/spotify/country/<cc|global>_<daily|weekly>.html (top 200, HTML table)

import { getJson, getText, stripTags } from './lib/torrent-kit.ts'
import type { ChartEntry, ChartExtension, Options, Paged } from './sdk.ts'

const SPOTIFY = 'https://charts-spotify-com-service.spotify.com/public/v0/charts'
const KWORB = 'https://kworb.net/spotify/country'
const PAGE_SIZE = 50

type Feed =
  | { source: 'spotify'; alias: 'REGIONAL_GLOBAL_WEEKLY' | 'ALBUM_GLOBAL_WEEKLY' }
  | { source: 'kworb'; period: 'daily' | 'weekly' }

/** Keyed by the category ids in index.json. */
export const FEEDS: Record<string, Feed> = {
  'global-songs': { source: 'spotify', alias: 'REGIONAL_GLOBAL_WEEKLY' },
  'global-albums': { source: 'spotify', alias: 'ALBUM_GLOBAL_WEEKLY' },
  'country-daily': { source: 'kworb', period: 'daily' },
  'country-weekly': { source: 'kworb', period: 'weekly' }
}

/** Two-letter country for the kworb charts; "global" if unset or invalid. */
export function country(options: Options): string {
  const value = typeof options.country === 'string' ? options.country.trim().toLowerCase() : ''
  return /^[a-z]{2}$/.test(value) ? value : 'global'
}

// --- Spotify's public feed ---

interface Artist {
  name?: string
}

export interface SpotifyEntry {
  trackMetadata?: { trackName?: string; displayImageUri?: string; artists?: Artist[] }
  albumMetadata?: { albumName?: string; displayImageUri?: string; artists?: Artist[] }
}

export interface SpotifyCharts {
  chartEntryViewResponses?: Array<{
    displayChart?: { chartMetadata?: { alias?: string } }
    entries?: SpotifyEntry[]
  }>
}

const credit = (artists: Artist[] | undefined): string | undefined =>
  (artists ?? [])
    .map(a => a.name?.trim())
    .filter(Boolean)
    .join(', ') || undefined

const httpsImage = (url: string | undefined): string | undefined => (url?.startsWith('https://') ? url : undefined)

export function parseSpotify(body: SpotifyCharts, alias: string): ChartEntry[] {
  const chart = body.chartEntryViewResponses?.find(c => c.displayChart?.chartMetadata?.alias === alias)
  return (chart?.entries ?? []).flatMap((entry): ChartEntry[] => {
    const track = entry.trackMetadata
    const album = entry.albumMetadata
    const meta = track ?? album
    const title = track?.trackName ?? album?.albumName
    const artist = credit(meta?.artists)
    if (!title || !artist) return []
    return [{ kind: track ? 'song' : 'album', title, artist, artwork: httpsImage(meta?.displayImageUri) }]
  })
}

// --- kworb.net country charts ---

/**
 * Rows of kworb's chart table: `<td class="text mp"><div><a>Artist</a> - <a>Title</a> (w/ <a>Guest</a>)</div></td>`.
 * The guests are added to the artist credit.
 */
export function parseKworb(html: string): ChartEntry[] {
  const entries: ChartEntry[] = []
  for (const [, cell] of html.matchAll(/<td class="text mp"><div>([\s\S]*?)<\/div><\/td>/g)) {
    const text = stripTags(cell).replace(/\s+([,)])/g, '$1')
    const dash = text.indexOf(' - ')
    if (dash <= 0) continue
    const artist = text.slice(0, dash).trim()
    let title = text.slice(dash + 3).trim()
    const guests = /\s*\(w\/\s*([^)]*)\)\s*$/.exec(title)
    if (guests) title = title.slice(0, guests.index).trim()
    // "Song | Coke Studio Bharat": the part after the bar names a series, not the song.
    title = title.replace(/\s+\|\s.*$/, '').trim()
    if (!artist || !title) continue
    entries.push({ kind: 'song', title, artist: guests ? `${artist}, ${guests[1].trim()}` : artist })
  }
  return entries
}

export const kworbUrl = (cc: string, period: 'daily' | 'weekly'): string => `${KWORB}/${cc}_${period}.html`

/** kworb lists the top 200 on one page; it's served 50 at a time. */
export function pageOf(entries: ChartEntry[], page: number): Paged<ChartEntry> {
  const start = (page - 1) * PAGE_SIZE
  return { results: entries.slice(start, start + PAGE_SIZE), hasMore: entries.length > start + PAGE_SIZE }
}

async function kworb(cc: string, period: 'daily' | 'weekly'): Promise<ChartEntry[]> {
  try {
    return parseKworb(await getText(kworbUrl(cc, period), 'kworb.net'))
  } catch (err) {
    if (err instanceof Error && /answered 404/.test(err.message))
      throw new Error(`Spotify has no chart for the country “${cc}”. Use a two-letter code such as us, gb or in.`)
    throw err
  }
}

const extension: ChartExtension = {
  async test({ options }) {
    const [official, local] = await Promise.all([
      getJson<SpotifyCharts>(SPOTIFY, 'Spotify'),
      kworb(country(options), 'weekly')
    ])
    if (parseSpotify(official, 'REGIONAL_GLOBAL_WEEKLY').length === 0)
      throw new Error('Spotify’s chart came back empty.')
    if (local.length === 0) throw new Error('kworb.net’s chart page has changed — the extension needs an update.')
    return true
  },

  async browse({ category, page = 1, options }) {
    const feed = FEEDS[category] ?? FEEDS['global-songs']
    if (feed.source === 'spotify') return parseSpotify(await getJson<SpotifyCharts>(SPOTIFY, 'Spotify'), feed.alias)
    return pageOf(await kworb(country(options), feed.period), page)
  }
}

export default extension
