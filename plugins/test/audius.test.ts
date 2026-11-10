// Offline tests for the Audius plugin. The responses are shaped after Audius's public API docs, not recorded from it.
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
import plugin from '../src/audius.ts'

const [manifest]: PluginManifest[] = parseRepository(
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'index.json'), 'utf8')).filter(
    (m: { id: string }) => m.id === 'audius'
  ),
  'https://example.org/index.json'
)

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const requested: string[] = []
function stubFetch(data: unknown, status = 200) {
  requested.length = 0
  globalThis.fetch = (async (url: string) => {
    requested.push(url)
    return { ok: status < 400, status, json: async () => ({ data }) }
  }) as unknown as typeof fetch
}

const TRACK = {
  id: 'D7KyD',
  title: 'Night Drive',
  duration: 187,
  genre: 'Electronic',
  release_date: '2021-03-04 00:00:00',
  user: { name: 'Some Artist' },
  artwork: { '150x150': 'https://cdn.example/small.jpg', '480x480': 'https://cdn.example/big.jpg' }
}

test('the manifest is a stream plugin that declares the API host', () => {
  assert.equal(manifest.type, 'stream')
  assert.deepEqual(manifest.hosts, ['api.audius.co'])
})

test('search passes the query and page to Audius and returns results the app accepts', async () => {
  stubFetch([TRACK, { ...TRACK, id: 'blocked', is_streamable: false }, { title: 'No id' }])
  const results = await plugin.search({ query: 'night drive & co', page: 2, options: {} })
  assert.match(
    requested[0],
    /^https:\/\/api\.audius\.co\/v1\/tracks\/search\?query=night%20drive%20%26%20co&limit=24&offset=24&app_name=/
  )
  const page = results as { results: unknown[]; hasMore: boolean }
  assert.equal(page.hasMore, false)
  const [album] = sanitizeStreamResults(page.results, manifest)
  assert.deepEqual(
    [album.ref, album.title, album.artist, album.year, album.artwork, album.tags],
    ['{"id":"D7KyD"}', 'Night Drive', 'Some Artist', '2021', 'https://cdn.example/big.jpg', ['Electronic']]
  )
})

test('open gives one track whose stream URL is on the declared host', async () => {
  stubFetch(TRACK)
  const opened = await plugin.open({ id: 'D7KyD', options: {} })
  assert.match(requested[0], /\/v1\/tracks\/D7KyD\?app_name=/)
  const album = sanitizeStreamAlbum(opened, manifest)
  assert.equal(album.tracks.length, 1)
  assert.match(album.tracks[0].url, /^https:\/\/api\.audius\.co\/v1\/tracks\/D7KyD\/stream\?app_name=/)
  assert.equal(album.tracks[0].duration, 187)
  assert.equal(album.coverUrl, 'https://cdn.example/big.jpg')
})

test('errors say what went wrong', async () => {
  stubFetch(null, 503)
  await assert.rejects(plugin.search({ query: 'x', options: {} }), /503/)
  stubFetch({ ...TRACK, is_streamable: false })
  await assert.rejects(plugin.open({ id: 'D7KyD', options: {} }), /doesn’t allow streaming/)
})
