// SoundCloud: tracks from independent artists and labels. The website's own API needs a public "client id" that
// its pages carry in their scripts; the plugin reads it from there. Only tracks that come as a plain file
// (progressive mp3/aac) are offered: those can be seeked. HLS-only tracks are left out.
import type { Paged, StreamAlbum, StreamPlugin, StreamResult } from './sdk'

const SITE = 'https://soundcloud.com/'
const API = 'https://api-v2.soundcloud.com'
const PAGE_SIZE = 20
/** Newest scripts first; the id lives in one of the last ones. */
const BUNDLES_TO_SCAN = 8

interface Transcoding {
  url?: string
  snipped?: boolean
  preset?: string
  format?: { protocol?: string; mime_type?: string }
}

interface ScTrack {
  id?: number
  title?: string
  duration?: number
  genre?: string
  policy?: string
  streamable?: boolean
  track_authorization?: string
  artwork_url?: string | null
  release_date?: string | null
  created_at?: string
  user?: { username?: string; avatar_url?: string }
  publisher_metadata?: { artist?: string }
  media?: { transcodings?: Transcoding[] }
}

/** The 32-character id after `client_id` in a page or script. */
export const findClientId = (text: string): string | undefined =>
  /client_id["':=\s]+["']?([a-zA-Z0-9]{32})\b/.exec(text)?.[1]

/** Addresses of the site's scripts, in page order. */
export const bundleUrls = (html: string): string[] =>
  [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(match => match[1])

/** A transcoding that is one file: not a preview, not HLS, not encrypted. */
export const progressiveOf = (track: ScTrack): Transcoding | undefined =>
  track.media?.transcodings?.find(
    t => t.url && !t.snipped && t.format?.protocol === 'progressive' && !/encrypted/i.test(t.format.mime_type ?? '')
  )

/** Full-length tracks that SoundCloud lets us play, as results. Previews (`SNIP`) and blocked tracks are left out. */
export function toResult(track: ScTrack): StreamResult | undefined {
  if (!track.id || !track.title || track.streamable === false) return undefined
  if (track.policy === 'BLOCK' || track.policy === 'SNIP' || !progressiveOf(track)) return undefined
  const date = track.release_date ?? track.created_at
  return {
    id: String(track.id),
    title: track.title,
    artist: track.publisher_metadata?.artist ?? track.user?.username,
    year: /^\d{4}/.exec(date ?? '')?.[0],
    artwork: bigger(track.artwork_url ?? track.user?.avatar_url),
    tags: track.genre ? [track.genre.slice(0, 12)] : undefined
  }
}

const bigger = (url?: string | null): string | undefined =>
  url?.replace(/-(?:large|t\d+x\d+)\./, '-t500x500.') ?? undefined

let clientId: string | undefined

async function text(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`SoundCloud answered with an error (${res.status}).`)
  return res.text()
}

async function loadClientId(): Promise<string> {
  const html = await text(SITE)
  let found = findClientId(html)
  for (const url of bundleUrls(html).reverse().slice(0, BUNDLES_TO_SCAN)) {
    if (found) break
    found = findClientId(await text(url))
  }
  if (!found) throw new Error('Couldn’t get SoundCloud’s access key from its website. The site may have changed.')
  return found
}

/** GET on the API; one retry with a fresh id when the saved one has been rejected. */
async function api<T>(path: string, retried = false): Promise<T> {
  clientId ??= await loadClientId()
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}client_id=${clientId}`)
  if ((res.status === 401 || res.status === 403) && !retried) {
    clientId = undefined
    return api<T>(path, true)
  }
  if (!res.ok) throw new Error(`SoundCloud answered with an error (${res.status}).`)
  return (await res.json()) as T
}

function page(tracks: ScTrack[]): Paged<StreamResult> {
  return {
    results: tracks.map(toResult).filter((r): r is StreamResult => r !== undefined),
    // The raw count: tracks left out above are no reason to stop paging.
    hasMore: tracks.length >= PAGE_SIZE
  }
}

export default {
  async test() {
    await api<unknown>('/search/tracks?q=music&limit=1')
    return true
  },

  async search({ query, page: pageNumber = 1 }) {
    const offset = (pageNumber - 1) * PAGE_SIZE
    const body = await api<{ collection?: ScTrack[] }>(
      `/search/tracks?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`
    )
    return page(body.collection ?? [])
  },

  async browse({ category, page: pageNumber = 1 }) {
    const kind = category === 'top' ? 'top' : 'trending'
    const offset = (pageNumber - 1) * PAGE_SIZE
    const body = await api<{ collection?: Array<{ track?: ScTrack }> }>(
      `/charts?kind=${kind}&genre=soundcloud%3Agenres%3Aall-music&limit=${PAGE_SIZE}&offset=${offset}`
    )
    return page((body.collection ?? []).flatMap(entry => (entry.track ? [entry.track] : [])))
  },

  async open({ id }): Promise<StreamAlbum> {
    const track = await api<ScTrack>(`/tracks/${encodeURIComponent(id)}`)
    const transcoding = progressiveOf(track)
    if (!track.title || !transcoding?.url) throw new Error('That track can’t be played from SoundCloud.')
    if (track.policy === 'BLOCK' || track.policy === 'SNIP')
      throw new Error('SoundCloud only allows a preview of that track.')
    const auth = track.track_authorization
      ? `?track_authorization=${encodeURIComponent(track.track_authorization)}`
      : ''
    const located = await api<{ url?: string }>(`${new URL(transcoding.url).pathname}${auth}`)
    if (!located.url) throw new Error('SoundCloud didn’t give an address for that track.')
    const artist = track.publisher_metadata?.artist ?? track.user?.username
    return {
      title: track.title,
      artist,
      artwork: bigger(track.artwork_url ?? track.user?.avatar_url),
      tracks: [
        {
          title: track.title,
          artist,
          url: located.url,
          duration: track.duration ? track.duration / 1000 : undefined,
          mime: transcoding.format?.mime_type?.split(';')[0],
          format: transcoding.format?.mime_type?.includes('mpeg') ? 'MP3' : 'AAC'
        }
      ]
    }
  }
} satisfies StreamPlugin
