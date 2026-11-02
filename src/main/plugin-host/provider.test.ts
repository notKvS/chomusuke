import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRepository } from './manifest.ts'
import { createPluginProvider, type PluginRuntime, testPlugin } from './provider.ts'

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

function fakeRuntime(): PluginRuntime & { calls: Array<[string, unknown]> } {
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

test('search and browse pass the query/category and user options to the plugin', async () => {
  const runtime = fakeRuntime()
  const provider = createPluginProvider(manifest, runtime, { apiKey: 'k' })
  assert.equal(provider.id, 'plugin-demo')
  assert.deepEqual(provider.categories, [{ id: 'top', name: 'Top' }])

  const { albums } = await provider.search('query', new AbortController().signal)
  assert.equal(albums.length, 2)
  await provider.browse?.('top', new AbortController().signal)
  assert.deepEqual(runtime.calls, [
    ['search', { query: 'query', page: 1, options: { apiKey: 'k' } }],
    ['browse', { category: 'top', page: 1, options: { apiKey: 'k' } }]
  ])
})

test('open validates magnets (stripping xs) and builds magnets from hashes', async () => {
  const provider = createPluginProvider(manifest, fakeRuntime(), {})
  const { albums } = await provider.search('q', new AbortController().signal)
  assert.equal((await provider.open(albums[0])).torrent, `magnet:?xt=urn:btih:${HASH}`)
  assert.equal((await provider.open(albums[1])).torrent, `magnet:?xt=urn:btih:${HASH}`)
})

test('plugins can page: { results, hasMore } and the page number', async () => {
  const pages: unknown[] = []
  const runtime: PluginRuntime = {
    async call(_method, args) {
      const { page } = args as { page: number }
      pages.push(page)
      return page === 1 ? { results: [{ title: 'First', hash: HASH }], hasMore: true } : { results: [], hasMore: true }
    }
  }
  const provider = createPluginProvider(manifest, runtime, {})
  assert.equal((await provider.search('q', new AbortController().signal)).hasMore, true)
  // An empty page never claims more, whatever the plugin says.
  assert.equal((await provider.browse?.('top', new AbortController().signal, 2))?.hasMore, false)
  assert.deepEqual(pages, [1, 2])
  // A plain list means a single page
  assert.equal(
    (await createPluginProvider(manifest, fakeRuntime(), {}).search('q', new AbortController().signal)).hasMore,
    false
  )
  await assert.rejects(
    createPluginProvider(manifest, { call: async () => ({ results: 'nope' }) }, {}).search(
      'q',
      new AbortController().signal
    ),
    /invalid response/
  )
})

test('testPlugin', async () => {
  assert.equal(await testPlugin(manifest, fakeRuntime(), {}), 'Demo is working.')
  await assert.rejects(testPlugin(manifest, { call: async () => 'nope' }, {}), /reported a problem/)
})

test('a chart plugin browses entries and opens them through findRelease', async () => {
  const [chart] = parseRepository(
    [
      {
        manifestVersion: 1,
        id: 'charts',
        name: 'Charts',
        version: '1.0.0',
        type: 'chart',
        code: 'c.js',
        hosts: ['example.org'],
        categories: [{ id: 'top', name: 'Top' }]
      }
    ],
    'https://example.org/index.json'
  )
  const calls: Array<[string, unknown]> = []
  const runtime: PluginRuntime = {
    async call(method, args) {
      calls.push([method, args])
      return [{ kind: 'song', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet' }]
    }
  }
  const wanted: unknown[] = []
  const provider = createPluginProvider(chart, runtime, { country: 'gb' }, async w => {
    wanted.push(w)
    return { kind: 'torrent', torrent: `magnet:?xt=urn:btih:${HASH}` }
  })
  assert.equal(provider.chart, true)
  assert.equal(provider.layout, 'cards')
  assert.deepEqual(await provider.search('anything', new AbortController().signal), { albums: [], songs: [] })

  const { albums } = (await provider.browse?.('top', new AbortController().signal)) ?? { albums: [] }
  assert.deepEqual(calls, [['browse', { category: 'top', page: 1, options: { country: 'gb' } }]])
  assert.equal(albums[0].chart, 'song')
  await provider.open(albums[0])
  assert.deepEqual(wanted, [{ kind: 'song', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet' }])
  await assert.rejects(provider.open({ ref: 'not json', title: 'x' }), /no longer available/)
})

test('a chart takes a country from Explore for one call, and tells Explore which country is saved', async () => {
  const [chart] = parseRepository(
    [
      {
        manifestVersion: 1,
        id: 'regional',
        name: 'Regional',
        version: '1.0.0',
        type: 'chart',
        code: 'c.js',
        hosts: ['example.org'],
        categories: [
          { id: 'global', name: 'Global' },
          { id: 'local', name: 'Local' }
        ],
        options: { country: { type: 'string', label: 'Country', default: '' } },
        region: { option: 'country', worldwide: true, categories: ['local', 'nope'] }
      }
    ],
    'https://example.org/index.json'
  )
  assert.deepEqual(chart.region, { option: 'country', worldwide: true, categories: ['local'] })
  const calls: unknown[] = []
  const runtime: PluginRuntime = {
    async call(_method, args) {
      calls.push(args)
      return []
    }
  }
  const provider = createPluginProvider(chart, runtime, { country: 'GB' }, undefined)
  assert.deepEqual(provider.region, { current: 'gb', worldwide: true, categories: ['local'] })

  const signal = new AbortController().signal
  await provider.browse?.('local', signal)
  await provider.browse?.('local', signal, 1, 'in')
  await provider.browse?.('local', signal, 1, '')
  assert.deepEqual(calls, [
    { category: 'local', page: 1, options: { country: 'GB' } },
    { category: 'local', page: 1, options: { country: 'in' } },
    { category: 'local', page: 1, options: { country: '' } }
  ])
})

test('a chart manifest only names a text option as its country', () => {
  const chart = (region: unknown, options: unknown) =>
    parseRepository(
      [
        {
          manifestVersion: 1,
          id: 'c',
          name: 'C',
          version: '1',
          type: 'chart',
          code: 'c.js',
          hosts: ['example.org'],
          categories: [{ id: 'top', name: 'Top' }],
          options,
          region
        }
      ],
      'https://example.org/index.json'
    )[0]
  const text = { country: { type: 'string', label: 'Country' } }
  assert.deepEqual(chart({ option: 'country' }, text).region, { option: 'country', worldwide: false })
  assert.equal(chart({ option: 'missing' }, text).region, undefined)
  assert.equal(chart({ option: 'country' }, { country: { type: 'boolean', label: 'C' } }).region, undefined)
  assert.equal(
    chart({ option: 'country' }, { country: { type: 'string', label: 'C', secret: true } }).region,
    undefined
  )
})

test('a plugin that needs details says so instead of running without them', async () => {
  const [asking] = parseRepository(
    [
      {
        manifestVersion: 1,
        id: 'asking',
        name: 'Asking',
        version: '1.0.0',
        type: 'torrent',
        code: 'a.js',
        hosts: ['example.org'],
        options: {
          username: { type: 'string', label: 'Username', required: true },
          password: { type: 'string', label: 'Password', secret: true, required: true }
        }
      }
    ],
    'https://example.org/index.json'
  )
  const runtime = fakeRuntime()
  const signal = new AbortController().signal

  const without = createPluginProvider(asking, runtime, { username: 'me', password: '' })
  await assert.rejects(without.search('adele', signal), /Asking needs your Password: open Settings → Plugins/)
  await assert.rejects(
    testPlugin(asking, runtime, { username: '', password: '' }),
    /Enter your Username and Password first/
  )
  assert.equal(runtime.calls.length, 0)

  const complete = { username: 'me', password: 'secret' }
  const provider = createPluginProvider(asking, runtime, complete)
  await provider.search('adele', signal)
  assert.deepEqual(runtime.calls[0], ['search', { query: 'adele', page: 1, options: complete }])
})
