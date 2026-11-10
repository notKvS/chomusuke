// Offline tests for the SoundCloud and JioSaavn plugins. The responses are shaped after what these services' web
// players receive (from the open-source clients that read them), not recorded from them.
import assert from 'node:assert/strict'
import { createCipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import {
  type PluginManifest,
  parseRepository,
  sanitizeStreamAlbum,
  sanitizeStreamResults
} from '../../src/main/plugin-host/manifest.ts'
import jiosaavn, { decodeEntities, decryptMediaUrl, withBitrate } from '../src/jiosaavn.ts'
import soundcloud, { bundleUrls, findClientId, progressiveOf } from '../src/soundcloud.ts'

const manifests = parseRepository(
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'index.json'), 'utf8')),
  'https://example.org/index.json'
)
const manifestOf = (id: string): PluginManifest => manifests.find(m => m.id === id) as PluginManifest

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Reply = { status?: number; json?: unknown; text?: string }
const requested: string[] = []
/** Answers by the first route whose pattern is in the URL. */
function stubFetch(routes: Array<[RegExp, Reply]>) {
  requested.length = 0
  globalThis.fetch = (async (url: string) => {
    requested.push(url)
    const reply = routes.find(([pattern]) => pattern.test(url))?.[1] ?? { status: 404 }
    const status = reply.status ?? 200
    return { ok: status < 400, status, json: async () => reply.json, text: async () => reply.text ?? '' }
  }) as unknown as typeof fetch
}

// --- JioSaavn ---------------------------------------------------------------------------------------------------

const encrypt = (url: string): string => {
  // Single DES is triple DES with the key three times over.
  const key = Buffer.from('38346591')
  const cipher = createCipheriv('des-ede3-ecb', Buffer.concat([key, key, key]), null)
  return Buffer.concat([cipher.update(url), cipher.final()]).toString('base64')
}
const STREAM = 'https://aac.saavncdn.com/123/abcdef_96.mp4'
const SONG = {
  id: 'Zb2Lc_x1',
  title: 'Tum Hi Ho &amp; More',
  subtitle: 'Arijit Singh - Aashiqui 2',
  image: 'https://c.saavncdn.com/430/Aashiqui-2-Hindi-2013-150x150.jpg',
  year: '2013',
  more_info: {
    duration: '262',
    '320kbps': 'true',
    encrypted_media_url: encrypt(STREAM),
    artistMap: { primary_artists: [{ name: 'Arijit Singh' }] }
  }
}

test('JioSaavn: the media address is decrypted like the web player does', () => {
  assert.equal(decryptMediaUrl(encrypt(STREAM)), STREAM)
  assert.throws(() => decryptMediaUrl('bm90IGRlcw=='), /couldn’t be read/)
  assert.equal(withBitrate(STREAM, 320), 'https://aac.saavncdn.com/123/abcdef_320.mp4')
  assert.equal(decodeEntities('Tom &amp; Jerry &quot;Hi&quot; &#39;x&#39; &#x41;'), 'Tom & Jerry "Hi" \'x\' A')
})

test('JioSaavn: search and open give results and a playable high-bitrate track the app accepts', async () => {
  const manifest = manifestOf('jiosaavn')
  stubFetch([[/search\.getResults/, { json: { results: [SONG, { id: 'x', title: 'No audio' }] } }]])
  const page = (await jiosaavn.search({ query: 'tum hi ho', options: {} })) as { results: unknown[] }
  assert.match(
    requested[0],
    /^https:\/\/www\.jiosaavn\.com\/api\.php\?__call=search\.getResults&q=tum%20hi%20ho&p=1&n=20&/
  )
  const [album] = sanitizeStreamResults(page.results, manifest)
  assert.deepEqual(
    [album.ref, album.title, album.artist, album.year, album.artwork],
    [
      '{"id":"Zb2Lc_x1"}',
      'Tum Hi Ho & More',
      'Arijit Singh',
      '2013',
      'https://c.saavncdn.com/430/Aashiqui-2-Hindi-2013-500x500.jpg'
    ]
  )

  stubFetch([[/song\.getDetails/, { json: { songs: [SONG] } }]])
  const opened = sanitizeStreamAlbum(await jiosaavn.open({ id: 'Zb2Lc_x1', options: {} }), manifest)
  assert.equal(opened.tracks[0].url, 'https://aac.saavncdn.com/123/abcdef_320.mp4')
  assert.equal(opened.tracks[0].duration, 262)
  assert.equal(opened.tracks[0].mime, 'audio/mp4')
})

test('JioSaavn: details can also come keyed by id, and a song without audio is an error', async () => {
  stubFetch([[/song\.getDetails/, { json: { Zb2Lc_x1: SONG } }]])
  assert.equal((await jiosaavn.open({ id: 'Zb2Lc_x1', options: {} })).tracks.length, 1)
  stubFetch([[/song\.getDetails/, { json: { songs: [{ id: 'a', title: 'Silent' }] } }]])
  await assert.rejects(jiosaavn.open({ id: 'a', options: {} }), /no audio/)
})

// --- SoundCloud -------------------------------------------------------------------------------------------------

const CLIENT_ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const progressive = {
  url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1/abc/stream/progressive',
  format: { protocol: 'progressive', mime_type: 'audio/mpeg' }
}
const hls = { url: 'https://api-v2.soundcloud.com/media/x/hls', format: { protocol: 'hls', mime_type: 'audio/mpeg' } }
const TRACK = {
  id: 1,
  title: 'Night Drive',
  duration: 187_500,
  genre: 'Electronic',
  policy: 'ALLOW',
  track_authorization: 'auth/token=',
  artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg',
  created_at: '2021-03-04T10:00:00Z',
  user: { username: 'someartist' },
  media: { transcodings: [hls, progressive] }
}
const HOME = `<script src="https://a-v2.sndcdn.com/assets/0-aaa.js"></script><script src="https://a-v2.sndcdn.com/assets/1-bbb.js"></script>`

test('SoundCloud: finds the client id in a page or script, and the scripts in the page', () => {
  assert.equal(findClientId(`x,client_id:"${CLIENT_ID}",y`), CLIENT_ID)
  assert.equal(findClientId(`?client_id=${CLIENT_ID}&app=1`), CLIENT_ID)
  assert.equal(findClientId('client_id:"short"'), undefined)
  assert.deepEqual(bundleUrls(HOME), [
    'https://a-v2.sndcdn.com/assets/0-aaa.js',
    'https://a-v2.sndcdn.com/assets/1-bbb.js'
  ])
  assert.equal(progressiveOf(TRACK), progressive)
  assert.equal(progressiveOf({ media: { transcodings: [hls, { ...progressive, snipped: true }] } }), undefined)
})

test('SoundCloud: search offers full tracks that come as one file, and open resolves the file address', async () => {
  const manifest = manifestOf('soundcloud')
  stubFetch([
    [/^https:\/\/soundcloud\.com\/$/, { text: HOME }],
    [/0-aaa\.js/, { text: 'nothing here' }],
    [/1-bbb\.js/, { text: `var a={client_id:"${CLIENT_ID}"}` }],
    [
      /search\/tracks/,
      {
        json: {
          collection: [
            TRACK,
            { ...TRACK, id: 2, title: 'Preview only', policy: 'SNIP' },
            { ...TRACK, id: 3, title: 'Stream only', media: { transcodings: [hls] } }
          ]
        }
      }
    ]
  ])
  const page = (await soundcloud.search({ query: 'night drive', options: {} })) as { results: unknown[] }
  assert.ok(requested.some(url => url.includes('search/tracks?q=night%20drive&limit=20&offset=0')))
  assert.ok(requested.at(-1)?.endsWith(`&client_id=${CLIENT_ID}`))
  const albums = sanitizeStreamResults(page.results, manifest)
  assert.deepEqual(
    albums.map(a => [a.ref, a.title, a.artist, a.year, a.artwork]),
    [['{"id":"1"}', 'Night Drive', 'someartist', '2021', 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg']]
  )

  stubFetch([
    [/\/tracks\/1\?/, { json: TRACK }],
    [/stream\/progressive/, { json: { url: 'https://cf-media.sndcdn.com/xyz.mp3?Policy=abc' } }]
  ])
  const opened = sanitizeStreamAlbum(await soundcloud.open({ id: '1', options: {} }), manifest)
  const asked = requested.find(url => url.includes('/stream/progressive'))
  assert.ok(asked?.includes('track_authorization=auth%2Ftoken%3D'))
  assert.equal(opened.tracks[0].url, 'https://cf-media.sndcdn.com/xyz.mp3?Policy=abc')
  assert.equal(opened.tracks[0].duration, 187.5)
  assert.equal(opened.tracks[0].format, 'MP3')
})

test('SoundCloud: a rejected client id is looked up again once', async () => {
  let calls = 0
  globalThis.fetch = (async (url: string) => {
    if (/^https:\/\/soundcloud\.com\/$/.test(url))
      return { ok: true, status: 200, text: async () => `x={client_id:"${CLIENT_ID}"}` }
    calls++
    const status = calls === 1 ? 401 : 200
    return { ok: status === 200, status, json: async () => ({ collection: [TRACK] }) }
  }) as unknown as typeof fetch
  const page = (await soundcloud.search({ query: 'x', options: {} })) as { results: unknown[] }
  assert.equal(page.results.length, 1)
  assert.equal(calls, 2)
})
