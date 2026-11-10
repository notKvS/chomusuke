// YouTube Music: search through YouTube Music's own web API, and play a song's audio.
//
// Playing: YouTube's player API hands out plain audio links to some device apps without the proof-of-origin token
// that the website needs. This plugin asks as one of those ("client"), in the order of CLIENTS below, and uses the
// first answer that has a usable link. YouTube can stop answering a client like that at any time: when it does,
// change or add an entry in CLIENTS (the notes next to each say what was seen last).
//
// Worked out from the open-source clients that do the same (Metrolist and its innertubex library, yt-dlp,
// SpotiFLAC's Mornye extensions); not recorded from YouTube by us.
import type { StreamAlbum, StreamPlugin, StreamResult } from './sdk'

const MUSIC = 'https://music.youtube.com'
const SEARCH = `${MUSIC}/youtubei/v1/search?prettyPrint=false`
const PLAYER = `${MUSIC}/youtubei/v1/player?prettyPrint=false`

/** The website's client: used for search, which needs no token. */
const WEB = { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', clientId: '67' }
/** The "songs only" filter of YouTube Music's search. */
const SONGS_ONLY = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'

interface PlayerClient {
  name: string
  id: string
  version: string
  /** More of the client's description: OS and device */
  details: Record<string, string>
  userAgent: string
}

/** Clients to ask for audio, best first. */
export const CLIENTS: PlayerClient[] = [
  {
    // Seen working without a token, with direct links and no `n` parameter. Rejects age-restricted and kids' videos.
    name: 'VISIONOS',
    id: '101',
    version: '0.1',
    details: {
      osName: 'VISION_OS',
      osVersion: '1.3',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice14,1',
      platform: 'MOBILE'
    },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  },
  {
    // The newer version of the same client; may stall on a fresh session.
    name: 'VISIONOS',
    id: '101',
    version: '1.02',
    details: { osName: 'visionOS', osVersion: '26.5.23O471', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1' },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
  }
]

interface Run {
  text?: string
  navigationEndpoint?: {
    watchEndpoint?: { videoId?: string }
    browseEndpoint?: {
      browseId?: string
      browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } }
    }
  }
}
interface Column {
  musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } }
}
interface Item {
  playlistItemData?: { videoId?: string }
  flexColumns?: Column[]
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Array<{ url?: string }> } } }
}

const ARTIST_PAGES = new Set([
  'MUSIC_PAGE_TYPE_ARTIST',
  'MUSIC_PAGE_TYPE_USER_CHANNEL',
  'MUSIC_PAGE_TYPE_LIBRARY_ARTIST'
])
const SEPARATOR = /^\s*[•·]\s*$/

const runsOf = (column?: Column): Run[] => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []

/** The song rows in a search answer. */
export function songItems(body: unknown): Item[] {
  const sections =
    (
      body as {
        contents?: {
          tabbedSearchResultsRenderer?: {
            tabs?: Array<{
              tabRenderer?: {
                content?: {
                  sectionListRenderer?: { contents?: Array<{ musicShelfRenderer?: { contents?: unknown[] } }> }
                }
              }
            }>
          }
        }
      }
    ).contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? []
  return sections
    .flatMap(section => section.musicShelfRenderer?.contents ?? [])
    .map(row => (row as { musicResponsiveListItemRenderer?: Item }).musicResponsiveListItemRenderer)
    .filter((item): item is Item => item !== undefined)
}

/** Thumbnails come small; Google's image hosts resize on request. */
const bigger = (url?: string): string | undefined => url?.replace(/=w\d+-h\d+/, '=w544-h544')

/** A row as a result: the video id, the title, and the artists named after it. */
export function toResult(item: Item): StreamResult | undefined {
  const [first, ...rest] = item.flexColumns ?? []
  const title = runsOf(first)[0]?.text
  const id = item.playlistItemData?.videoId ?? runsOf(first)[0]?.navigationEndpoint?.watchEndpoint?.videoId
  if (!id || !title) return undefined

  const meta = rest.flatMap(runsOf)
  const artists = meta
    .filter(run => {
      const endpoint = run.navigationEndpoint?.browseEndpoint
      const page = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
      return (page && ARTIST_PAGES.has(page)) || endpoint?.browseId?.startsWith('UC')
    })
    .map(run => run.text)
  // Without links to the artists' pages, the text up to the first separator is who made it.
  const beforeSeparator = (): string | undefined => {
    const end = meta.findIndex(run => SEPARATOR.test(run.text ?? ''))
    return meta
      .slice(0, end < 0 ? meta.length : end)
      .map(run => run.text)
      .join('')
      .trim()
  }
  const artist = artists.length > 0 ? artists.join(', ') : beforeSeparator()
  const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? []
  return { id, title, artist: artist || undefined, artwork: bigger(thumbnails.at(-1)?.url) }
}

export function visitorFromServiceWorker(text: string): string | undefined {
  try {
    const value = JSON.parse(text.slice(text.indexOf('\n') + 1))?.[0]?.[2]?.[0]?.[0]?.[13]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

export const visitorFromPage = (html: string): string | undefined =>
  /"(?:VISITOR_DATA|visitorData)"\s*:\s*"([^"]+)"/.exec(html)?.[1]

interface Format {
  url?: string
  mimeType?: string
  bitrate?: number
}

/** The audio to play: a plain link (no `n` parameter, which would need deciphering), Opus before AAC, then bitrate. */
export function pickAudio(formats: Format[]): (Format & { url: string; mimeType: string }) | undefined {
  const usable = formats.filter(
    (f): f is Format & { url: string; mimeType: string } =>
      Boolean(f.url) && f.mimeType?.startsWith('audio/') === true && !/[?&]n=/.test(f.url ?? '')
  )
  const rank = (f: Format) => (f.mimeType?.includes('webm') ? 1_000_000_000 : 0) + (f.bitrate ?? 0)
  return usable.sort((a, b) => rank(b) - rank(a))[0]
}

let visitorData: string | undefined

async function getVisitorData(): Promise<string> {
  if (visitorData) return visitorData
  const worker = await fetch('https://www.youtube.com/sw.js_data')
  if (worker.ok) visitorData = visitorFromServiceWorker(await worker.text())
  if (!visitorData) {
    const home = await fetch(`${MUSIC}/`)
    if (home.ok) visitorData = visitorFromPage(await home.text())
  }
  if (!visitorData) throw new Error('Couldn’t start a session with YouTube Music.')
  return visitorData
}

function contextOf(client: { clientName: string; clientVersion: string }, extra: Record<string, string>) {
  return {
    client: { ...client, ...extra, gl: 'US', hl: 'en', visitorData },
    request: { internalExperimentFlags: [], useSsl: true },
    user: { lockedSafetyMode: false }
  }
}

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Format-Version': '1', ...headers },
    body: JSON.stringify(body)
  })
}

interface PlayerAnswer {
  playabilityStatus?: { status?: string; reason?: string }
  streamingData?: { adaptiveFormats?: Format[] }
  videoDetails?: {
    title?: string
    author?: string
    lengthSeconds?: string
    thumbnail?: { thumbnails?: Array<{ url?: string }> }
  }
}

async function search(query: string): Promise<{ results: StreamResult[]; hasMore: boolean }> {
  const visitor = await getVisitorData()
  const res = await post(
    SEARCH,
    { context: contextOf(WEB, {}), query, params: SONGS_ONLY },
    {
      'X-YouTube-Client-Name': WEB.clientId,
      'X-YouTube-Client-Version': WEB.clientVersion,
      'X-Goog-Visitor-Id': visitor,
      'X-Plugin-Origin': MUSIC,
      'X-Plugin-Referer': `${MUSIC}/`
    }
  )
  if (!res.ok) throw new Error(`YouTube Music answered with an error (${res.status}).`)
  const results = songItems(await res.json())
    .map(toResult)
    .filter((r): r is StreamResult => r !== undefined)
  return { results, hasMore: false }
}

export default {
  async test() {
    const { results } = await search('music')
    if (results.length === 0) throw new Error('YouTube Music answered, but with no songs.')
    return true
  },

  search: ({ query }) => search(query),

  async open({ id }): Promise<StreamAlbum> {
    const visitor = await getVisitorData()
    let reason = 'YouTube gave no audio link for that video.'
    for (const client of CLIENTS) {
      const res = await post(
        PLAYER,
        {
          context: contextOf({ clientName: client.name, clientVersion: client.version }, client.details),
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true
        },
        {
          'X-YouTube-Client-Name': client.id,
          'X-YouTube-Client-Version': client.version,
          'X-Goog-Visitor-Id': visitor,
          'X-Plugin-User-Agent': client.userAgent,
          'X-Plugin-Origin': MUSIC,
          'X-Plugin-Referer': `${MUSIC}/`
        }
      )
      if (!res.ok) continue
      const answer = (await res.json()) as PlayerAnswer
      const audio = pickAudio(answer.streamingData?.adaptiveFormats ?? [])
      if (!audio) {
        reason = answer.playabilityStatus?.reason ?? reason
        continue
      }
      const details = answer.videoDetails
      const length = Number(details?.lengthSeconds)
      const title = details?.title ?? 'YouTube video'
      const artist = details?.author?.replace(/ - Topic$/, '')
      return {
        title,
        artist,
        artwork: bigger(details?.thumbnail?.thumbnails?.at(-1)?.url),
        tracks: [
          {
            title,
            artist,
            url: audio.url,
            duration: Number.isFinite(length) && length > 0 ? length : undefined,
            mime: audio.mimeType.split(';')[0],
            format: audio.mimeType.includes('webm') ? 'OPUS' : 'M4A'
          }
        ]
      }
    }
    throw new Error(reason)
  }
} satisfies StreamPlugin
