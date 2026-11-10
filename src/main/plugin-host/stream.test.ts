import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HttpPlayable } from '../providers/types.ts'
import { SourceError } from '../source.ts'
import { type PluginManifest, parseRepository, sanitizeStreamAlbum, sanitizeStreamResults } from './manifest.ts'
import { createPluginProvider, type PluginRuntime } from './provider.ts'

const [manifest]: PluginManifest[] = parseRepository(
  [
    {
      manifestVersion: 1,
      id: 'demo-stream',
      name: 'Demo stream',
      version: '1.0.0',
      type: 'stream',
      code: 'demo.js',
      hosts: ['media.example.org', '*.cdn.example.org'],
      categories: [{ id: 'top', name: 'Top' }]
    }
  ],
  'https://example.org/index.json'
)

test('a stream manifest is accepted and shown as cards', () => {
  assert.equal(manifest.type, 'stream')
  assert.equal(manifest.layout, 'cards')
})

test('stream results need a title and an id, and the id is the only locator kept', () => {
  const albums = sanitizeStreamResults(
    [
      { id: 'a1', title: 'One', artist: 'Someone', year: '2020', artwork: 'https://img.example.org/a.jpg', link: 'x' },
      { id: 'a1', title: 'Duplicate' },
      { title: 'No id' },
      { id: 'a2' },
      { id: 'a3', title: 'Bad art', artwork: 'http://img.example.org/a.jpg' },
      'junk'
    ],
    manifest
  )
  assert.deepEqual(
    albums.map(a => [a.ref, a.title, a.artwork]),
    [
      ['{"id":"a1"}', 'One', 'https://img.example.org/a.jpg'],
      ['{"id":"a3"}', 'Bad art', undefined]
    ]
  )
  assert.throws(() => sanitizeStreamResults({ not: 'a list' }, manifest))
})

test('tracks must be https on a declared host; headers are limited to the allow-list', () => {
  const album = sanitizeStreamAlbum(
    {
      title: 'Album',
      tracks: [
        {
          title: 'Good',
          url: 'https://media.example.org/a.mp3',
          headers: { Referer: 'https://example.org/', 'X-Evil': '1', Cookie: 'a=b\r\nHost: evil', 'User-Agent': 'UA' },
          duration: 61,
          mime: 'audio/MPEG',
          format: 'mp3'
        },
        { title: 'Subdomain', url: 'https://eu.cdn.example.org/b.mp3' },
        { title: 'Other host', url: 'https://evil.example.net/c.mp3' },
        { title: 'Plain http', url: 'http://media.example.org/d.mp3' },
        { title: 'Port', url: 'https://media.example.org:8443/e.mp3' },
        { title: 'Credentials', url: 'https://user:pw@media.example.org/f.mp3' },
        { url: 'https://media.example.org/g.mp3' },
        { title: 'Not audio', url: 'https://media.example.org/h.mp3', mime: 'text/html', duration: 999999 }
      ]
    },
    manifest
  )
  assert.deepEqual(
    album.tracks.map(t => t.title),
    ['Good', 'Subdomain', 'Not audio']
  )
  const [good, , notAudio] = album.tracks
  assert.deepEqual(good.headers, { Referer: 'https://example.org/', 'User-Agent': 'UA' })
  assert.equal(good.mime, 'audio/mpeg')
  assert.equal(good.format, 'MP3')
  assert.equal(good.duration, 61)
  assert.equal(notAudio.mime, undefined)
  assert.equal(notAudio.duration, undefined)
  assert.throws(() => sanitizeStreamAlbum({ tracks: [{ title: 'x', url: 'https://evil.example.net/x' }] }, manifest))
  assert.throws(() => sanitizeStreamAlbum({ title: 'no tracks' }, manifest))
})

function fakeRuntime(): PluginRuntime & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    async call(method, args) {
      calls.push([method, args])
      if (method === 'open') {
        return { artist: 'Artist', tracks: [{ title: 'Song', url: 'https://media.example.org/s.mp3', duration: 30 }] }
      }
      return [{ id: 'track 1', title: 'Song' }]
    }
  }
}

test('search finds results by id and open turns one into an http playable', async () => {
  const runtime = fakeRuntime()
  const provider = createPluginProvider(manifest, runtime, { key: 'v' })
  const { albums } = await provider.search('q', new AbortController().signal)
  assert.equal(albums.length, 1)

  const playable = (await provider.open(albums[0])) as HttpPlayable
  assert.equal(playable.kind, 'http')
  assert.match(playable.id, /^[a-f0-9]{40}$/)
  assert.equal(playable.title, 'Song') // falls back to the result's title
  assert.equal(playable.artist, 'Artist')
  assert.equal(playable.tracks[0].url, 'https://media.example.org/s.mp3')
  assert.deepEqual(runtime.calls.at(-1), ['open', { id: 'track 1', options: { key: 'v' } }])

  // The same result gives the same id; another plugin or result gives another.
  assert.equal(((await provider.open(albums[0])) as HttpPlayable).id, playable.id)
})

test('a plugin that has nothing to play surfaces as a message for the user', async () => {
  const runtime: PluginRuntime = {
    async call() {
      return { tracks: [] }
    }
  }
  const provider = createPluginProvider(manifest, runtime, {})
  await assert.rejects(
    provider.open({ ref: '{"id":"x"}', title: 'x' }),
    (err: Error) => err instanceof SourceError && /nothing to play/.test(err.message)
  )
})
