import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRepository } from './manifest.ts'
import { createExtensionProvider, type ExtensionRuntime, testExtension } from './provider.ts'

const [manifest] = parseRepository(
  [
    {
      manifestVersion: 1,
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      type: 'torrent',
      code: 'demo.js',
      hosts: ['example.org'],
      categories: [{ id: 'top', name: 'Top' }]
    }
  ],
  'https://example.org/index.json'
)
const HASH = 'c9e15763f722f23e98a29decdfae341b98d53056'

function fakeRuntime(): ExtensionRuntime & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    async call(method, args) {
      calls.push([method, args])
      if (method === 'test') return true
      return [
        { title: 'Magnet result', link: `magnet:?xt=urn:btih:${HASH}&xs=http://evil.example/x` },
        { title: 'Hash result', hash: HASH.toUpperCase() }
      ]
    }
  }
}

test('search and browse pass the query/category and user options to the extension', async () => {
  const runtime = fakeRuntime()
  const provider = createExtensionProvider(manifest, runtime, { apiKey: 'k' })
  assert.equal(provider.id, 'ext-demo')
  assert.deepEqual(provider.categories, [{ id: 'top', name: 'Top' }])

  const { albums } = await provider.search('query', new AbortController().signal)
  assert.equal(albums.length, 2)
  await provider.browse?.('top', new AbortController().signal)
  assert.deepEqual(runtime.calls, [
    ['search', { query: 'query', options: { apiKey: 'k' } }],
    ['browse', { category: 'top', options: { apiKey: 'k' } }]
  ])
})

test('open validates magnets (stripping xs) and builds magnets from hashes', async () => {
  const provider = createExtensionProvider(manifest, fakeRuntime(), {})
  const { albums } = await provider.search('q', new AbortController().signal)
  assert.equal((await provider.open(albums[0])).torrent, `magnet:?xt=urn:btih:${HASH}`)
  assert.equal((await provider.open(albums[1])).torrent, `magnet:?xt=urn:btih:${HASH}`)
})

test('testExtension', async () => {
  assert.equal(await testExtension(manifest, fakeRuntime(), {}), 'Demo is working.')
  await assert.rejects(testExtension(manifest, { call: async () => 'nope' }, {}), /reported a problem/)
})
