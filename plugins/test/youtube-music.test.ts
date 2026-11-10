// Offline tests for the YouTube Music plugin. The answers are shaped after what the open-source clients read from
// YouTube Music's API (Metrolist, ytmusicapi), not recorded from it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import {
  type PluginManifest,
  parseRepository,
  sanitizeStreamAlbum,
  sanitizeStreamResults
} from '../../src/main/plugin-host/manifest.ts'
import plugin, {
  CLIENTS,
  pickAudio,
  songItems,
  toResult,
  visitorFromPage,
  visitorFromServiceWorker
} from '../src/youtube-music.ts'

const [manifest]: PluginManifest[] = parseRepository(
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'index.json'), 'utf8')).filter(
    (m: { id: string }) => m.id === 'youtube-music'
  ),
  'https://example.org/index.json'
)

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const artistRun = (text: string, pageType = 'MUSIC_PAGE_TYPE_ARTIST') => ({
  text,
  navigationEndpoint: {
    browseEndpoint: {
      browseId: 'UC123',
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } }
    }
  }
})
const column = (...runs: unknown[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } })
const row = (videoId: string, title: string, ...meta: unknown[]) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [column({ text: title }), column(...meta)],
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [
            { url: 'https://lh3.googleusercontent.com/small=w60-h60-l90-rj' },
            { url: 'https://lh3.googleusercontent.com/art=w226-h226-l90-rj' }
          ]
        }
      }
    }
  }
})
const SEARCH_ANSWER = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      contents: [
                        row(
                          'abc123',
                          'Get Lucky',
                          artistRun('Daft Punk'),
                          { text: ' • ' },
                          { text: 'Random Access Memories' },
                          { text: ' • ' },
                          { text: '6:09' }
                        ),
                        // No links on the artists: the text before the first separator is who made it.
                        row(
                          'def456',
                          'Plain',
                          { text: 'Some' },
                          { text: ' & ' },
                          { text: 'Band' },
                          { text: ' • ' },
                          { text: '3:00' }
                        )
                      ]
                    }
                  },
                  { musicCardShelfRenderer: {} }
                ]
              }
            }
          }
        }
      ]
    }
  }
}

test('search rows become results with the artists, the video id and a bigger cover', () => {
  const results = songItems(SEARCH_ANSWER).map(toResult)
  assert.deepEqual(results, [
    {
      id: 'abc123',
      title: 'Get Lucky',
      artist: 'Daft Punk',
      artwork: 'https://lh3.googleusercontent.com/art=w544-h544-l90-rj'
    },
    {
      id: 'def456',
      title: 'Plain',
      artist: 'Some & Band',
      artwork: 'https://lh3.googleusercontent.com/art=w544-h544-l90-rj'
    }
  ])
  assert.deepEqual(songItems({}), [])
  assert.equal(toResult({ flexColumns: [column({ text: 'No id' })] } as never), undefined)
})

test('the visitor id comes from the service worker data, or else from the page', () => {
  assert.equal(
    visitorFromServiceWorker(
      `)]}'\n[[null,null,[[[null,null,null,null,null,null,null,null,null,null,null,null,null,"Cgt2aXNpdG9y"]]]]]`
    ),
    'Cgt2aXNpdG9y'
  )
  assert.equal(visitorFromServiceWorker('not json'), undefined)
  assert.equal(visitorFromPage('x,"VISITOR_DATA":"Cgt2aXNpdG9y%3D%3D",y'), 'Cgt2aXNpdG9y%3D%3D')
  assert.equal(visitorFromPage('nothing'), undefined)
})

test('the audio picked is a plain link: Opus before AAC, higher bitrate first, nothing that needs deciphering', () => {
  const opusLow = {
    url: 'https://r1.googlevideo.com/a?itag=250',
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 50_000
  }
  const opusHigh = {
    url: 'https://r1.googlevideo.com/b?itag=251',
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 130_000
  }
  const aac = {
    url: 'https://r1.googlevideo.com/c?itag=140',
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 130_000
  }
  const throttled = { url: 'https://r1.googlevideo.com/d?n=abc&itag=251', mimeType: 'audio/webm', bitrate: 999_000 }
  const video = { url: 'https://r1.googlevideo.com/e', mimeType: 'video/mp4', bitrate: 9_000_000 }
  assert.equal(pickAudio([aac, opusLow, opusHigh, throttled, video]), opusHigh)
  assert.equal(pickAudio([aac, video]), aac)
  assert.equal(pickAudio([throttled, video, { mimeType: 'audio/webm' }]), undefined)
})

/** Answers by the URL; remembers every request. */
const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
function stubFetch(routes: Array<[RegExp, () => { status?: number; json?: unknown; text?: string }]>) {
  requests.length = 0
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    requests.push({ url, headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : {} })
    const reply = routes.find(([pattern]) => pattern.test(url))?.[1]() ?? { status: 404 }
    const status = reply.status ?? 200
    return { ok: status < 400, status, json: async () => reply.json, text: async () => reply.text ?? '' }
  }) as unknown as typeof fetch
}
const VISITOR: [RegExp, () => { text: string }] = [
  /sw\.js_data/,
  () => ({
    text: `)]}'\n[[null,null,[[[null,null,null,null,null,null,null,null,null,null,null,null,null,"VISITORID"]]]]]`
  })
]

test('search asks YouTube Music for songs as its web client, with the session’s visitor id', async () => {
  stubFetch([VISITOR, [/youtubei\/v1\/search/, () => ({ json: SEARCH_ANSWER })]])
  const { results } = await plugin.search({ query: 'get lucky', options: {} })
  const search = requests.find(r => r.url.includes('/v1/search'))
  assert.ok(search)
  assert.equal(search.body.query, 'get lucky')
  assert.equal(search.body.params, 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D')
  assert.equal(search.headers['X-Goog-Visitor-Id'], 'VISITORID')
  assert.equal((search.body.context as { client: { clientName: string } }).client.clientName, 'WEB_REMIX')
  assert.deepEqual(
    sanitizeStreamResults(results, manifest).map(a => [a.ref, a.title, a.artist]),
    [
      ['{"id":"abc123"}', 'Get Lucky', 'Daft Punk'],
      ['{"id":"def456"}', 'Plain', 'Some & Band']
    ]
  )
})

const PLAYABLE = {
  playabilityStatus: { status: 'OK' },
  videoDetails: {
    title: 'Get Lucky',
    author: 'Daft Punk - Topic',
    lengthSeconds: '369',
    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hq.jpg' }] }
  },
  streamingData: {
    adaptiveFormats: [
      {
        url: 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=251&expire=1',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 130_000
      },
      {
        url: 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=140',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 129_000
      }
    ]
  }
}

test('open asks as the first client, and gives the audio link on YouTube’s servers', async () => {
  stubFetch([VISITOR, [/youtubei\/v1\/player/, () => ({ json: PLAYABLE })]])
  const opened = sanitizeStreamAlbum(await plugin.open({ id: 'abc123', options: {} }), manifest)
  const player = requests.find(r => r.url.includes('/v1/player'))
  assert.ok(player)
  const { client } = player.body.context as { client: Record<string, string> }
  assert.equal(client.clientName, CLIENTS[0].name)
  assert.equal(client.clientVersion, CLIENTS[0].version)
  assert.equal(client.visitorData, 'VISITORID')
  assert.equal(player.body.videoId, 'abc123')
  assert.equal(player.headers['X-Plugin-User-Agent'], CLIENTS[0].userAgent)
  assert.equal(player.headers['X-YouTube-Client-Name'], CLIENTS[0].id)
  assert.equal(opened.title, 'Get Lucky')
  assert.equal(opened.artist, 'Daft Punk')
  assert.deepEqual(
    [opened.tracks[0].url, opened.tracks[0].mime, opened.tracks[0].format, opened.tracks[0].duration],
    ['https://rr1---sn-x.googlevideo.com/videoplayback?itag=251&expire=1', 'audio/webm', 'OPUS', 369]
  )
})

test('when a client gets no audio, the next one is tried; when none does, YouTube’s reason is the error', async () => {
  let asked = 0
  stubFetch([
    VISITOR,
    [
      /youtubei\/v1\/player/,
      () =>
        ++asked === 1
          ? { json: { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' } } }
          : { json: PLAYABLE }
    ]
  ])
  assert.equal((await plugin.open({ id: 'abc123', options: {} })).tracks.length, 1)
  assert.equal(asked, 2)

  stubFetch([
    VISITOR,
    [/youtubei\/v1\/player/, () => ({ json: { playabilityStatus: { reason: 'Sign in to confirm' } } })]
  ])
  await assert.rejects(plugin.open({ id: 'abc123', options: {} }), /Sign in to confirm/)
})
