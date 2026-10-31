// YouTube Music charts: the weekly top songs and top music videos on YouTube, worldwide or for one country — the
// data behind charts.youtube.com, read from the same public endpoint that site uses (no account or key). It isn't a
// documented API, so it may change. Entries have no torrents: the app plays them by searching the torrent sources.
// API: POST https://charts.youtube.com/youtubei/v1/browse?alt=json with an "analytics" client context.

import { getJson } from './lib/torrent-kit.ts'
import type { ChartEntry, ChartExtension, Options } from './sdk.ts'

const API = 'https://charts.youtube.com/youtubei/v1/browse?alt=json'
const SITE = 'YouTube Music charts'

/** Keyed by the category ids in index.json. */
export const CHARTS: Record<string, { type: 'TRACKS' | 'VIDEOS'; views: 'trackViews' | 'videoViews' }> = {
  'top-songs': { type: 'TRACKS', views: 'trackViews' },
  'top-videos': { type: 'VIDEOS', views: 'videoViews' }
}

/** Two-letter country, or "global" if unset or invalid. */
export function country(options: Options): string {
  const value = typeof options.country === 'string' ? options.country.trim().toLowerCase() : ''
  return /^[a-z]{2}$/.test(value) ? value : 'global'
}

export function requestBody(type: string, cc: string): string {
  return JSON.stringify({
    context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'en', gl: 'US' } },
    browseId: 'FEmusic_analytics_charts_home',
    query: `perspective=CHART_DETAILS&chart_params_country_code=${cc}&chart_params_chart_type=${type}&chart_params_period_type=WEEKLY`
  })
}

export interface ChartView {
  id?: string
  /** Tracks */
  name?: string
  /** Videos */
  title?: string
  artists?: Array<{ name?: string }>
  thumbnail?: { thumbnails?: Array<{ url?: string }> }
}

/** The first array named `key` in the response (the layout around it nests deeply and varies by chart). */
export function findViews(node: unknown, key: string, depth = 0): ChartView[] {
  if (depth > 12 || typeof node !== 'object' || node === null) return []
  const record = node as Record<string, unknown>
  if (Array.isArray(record[key])) return record[key] as ChartView[]
  for (const value of Object.values(record)) {
    const found = findViews(value, key, depth + 1)
    if (found.length > 0) return found
  }
  return []
}

const VIDEO_ID = /^[\w-]{11}$/

function artwork(view: ChartView, video: boolean): string | undefined {
  if (video && view.id && VIDEO_ID.test(view.id)) return `https://i.ytimg.com/vi/${view.id}/hqdefault.jpg`
  const thumbnails = view.thumbnail?.thumbnails ?? []
  const url = thumbnails[thumbnails.length - 1]?.url
  // Track art is a sized googleusercontent URL ("…=w180-h180-…"); ask for a sharper one.
  return url?.startsWith('https://') ? url.replace(/=w\d+-h\d+/, '=w400-h400') : undefined
}

/** "Artist - Song (Official Music Video)" → "Song": video titles carry extras that release names don't. */
export function cleanVideoTitle(title: string, artist: string): string {
  let clean = title
    .replace(/\s*[([][^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|mv|m\/v)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*\|.*$/, '')
    .trim()
  const lead = artist.split(',')[0].trim().toLowerCase()
  const dash = /\s[-–—]\s/.exec(clean)
  if (dash && lead && clean.slice(0, dash.index).toLowerCase().includes(lead))
    clean = clean.slice(dash.index + dash[0].length).trim()
  return clean || title
}

export function parseChart(body: unknown, chart: (typeof CHARTS)[string]): ChartEntry[] {
  const video = chart.views === 'videoViews'
  return findViews(body, chart.views).flatMap((view): ChartEntry[] => {
    const artist = (view.artists ?? [])
      .map(a => a.name?.trim())
      .filter(Boolean)
      .join(', ')
    const raw = (video ? view.title : view.name)?.trim()
    if (!raw || !artist) return []
    const title = video ? cleanVideoTitle(raw, artist) : raw
    return [{ kind: 'song', title, artist, artwork: artwork(view, video) }]
  })
}

async function fetchChart(chart: (typeof CHARTS)[string], cc: string): Promise<ChartEntry[]> {
  let body: unknown
  try {
    body = await getJson(API, SITE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody(chart.type, cc)
    })
  } catch (err) {
    if (err instanceof Error && /answered 400/.test(err.message) && cc !== 'global')
      throw new Error(`YouTube has no chart for the country “${cc}”. Use a two-letter code such as us, gb or in.`)
    throw err
  }
  const entries = parseChart(body, chart)
  if (entries.length === 0) throw new Error(`${SITE} sent no chart — its format may have changed.`)
  return entries
}

const extension: ChartExtension = {
  async test({ options }) {
    await fetchChart(CHARTS['top-songs'], country(options))
    return true
  },

  async browse({ category, options }) {
    return fetchChart(CHARTS[category] ?? CHARTS['top-songs'], country(options))
  }
}

export default extension
