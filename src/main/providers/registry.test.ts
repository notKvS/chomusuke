import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SourceError } from '../source.ts'
import { ProviderRegistry } from './registry.ts'
import { TorznabError } from './torznab.ts'
import type { MusicProvider, ProviderAlbum } from './types.ts'

const album = (ref: string, title = ref): ProviderAlbum => ({ ref, title })

function fakeProvider(id: string, behaviour: Partial<MusicProvider> = {}): MusicProvider & { opened: string[] } {
  const opened: string[] = []
  return {
    id,
    name: id.toUpperCase(),
    layout: 'cards',
    opened,
    search: async () => ({
      albums: [album(`${id}-secret-locator`, 'An Album')],
      songs: [{ key: '01_song', title: 'Song', album: album(`${id}-other`) }]
    }),
    open: async a => {
      opened.push(a.ref)
      return { kind: 'torrent', torrent: `magnet:?xt=urn:btih:${'a'.repeat(40)}` }
    },
    ...behaviour
  }
}

test('merges providers into sections and songs; locators never reach the renderer', async () => {
  const registry = new ProviderRegistry()
  registry.setProviders([fakeProvider('archive'), fakeProvider('torznab-1')])
  const results = await registry.search('q', new AbortController().signal)

  assert.deepEqual(
    results.sections.map(s => [s.id, s.name, s.albums.length]),
    [
      ['archive', 'ARCHIVE', 1],
      ['torznab-1', 'TORZNAB-1', 1]
    ]
  )
  assert.equal(results.songs.length, 2)
  assert.doesNotMatch(JSON.stringify(results), /secret-locator|"ref"/)
  assert.match(results.sections[0].albums[0].id, /^archive:[a-f0-9]{24}$/)
})

test('ids are stable and open() routes to the right provider', async () => {
  const registry = new ProviderRegistry()
  const archive = fakeProvider('archive')
  registry.setProviders([archive])
  const first = await registry.search('q', new AbortController().signal)
  const second = await registry.search('q', new AbortController().signal)
  const id = first.sections[0].albums[0].id
  assert.equal(second.sections[0].albums[0].id, id)

  await registry.open(id)
  assert.deepEqual(archive.opened, ['archive-secret-locator'])
  await assert.rejects(registry.open('archive:000000000000000000000000'), SourceError)
  await assert.rejects(registry.open({ evil: true }), SourceError)
})

test('one failing provider does not sink the others', async () => {
  const registry = new ProviderRegistry()
  registry.setProviders([
    fakeProvider('archive', { search: async () => Promise.reject(new Error('socket hang up at http://secret')) }),
    fakeProvider('torznab-1', { search: async () => Promise.reject(new TorznabError('The indexer said: bad key')) }),
    fakeProvider('torznab-2')
  ])
  const { sections } = await registry.search('q', new AbortController().signal)
  assert.equal(sections[0].error, "Couldn't reach ARCHIVE.")
  assert.equal(sections[1].error, 'The indexer said: bad key')
  assert.equal(sections[2].albums.length, 1)
})

test('results from removed providers can no longer be opened', async () => {
  const registry = new ProviderRegistry()
  registry.setProviders([fakeProvider('torznab-1')])
  const { sections } = await registry.search('q', new AbortController().signal)
  registry.setProviders([])
  await assert.rejects(registry.open(sections[0].albums[0].id), /expired/)
})

const chartProvider = (behaviour: Partial<MusicProvider> = {}) =>
  fakeProvider('plugin-charts', {
    chart: true,
    categories: [{ id: 'top', name: 'Top' }],
    browse: async () => ({
      albums: [{ ...album('chart-ref', 'Mayhem'), artist: 'Lady Gaga', chart: 'album' }],
      songs: []
    }),
    ...behaviour
  })

test('Explore lists only charts, says whether a provider can play them, and browse remembers results', async () => {
  const registry = new ProviderRegistry()
  const archive = fakeProvider('archive', {
    categories: [{ id: 'trending', name: 'Trending' }],
    browse: async () => ({ albums: [album('hot-locator', 'Hot')], songs: [] })
  })
  const charts = chartProvider()
  registry.setProviders([archive, charts])
  assert.deepEqual(registry.explore(), {
    charts: [{ id: 'plugin-charts', name: 'PLUGIN-CHARTS', categories: [{ id: 'top', name: 'Top' }] }],
    canPlay: true
  })

  const section = await registry.browse('plugin-charts', 'top', new AbortController().signal)
  assert.equal(section.albums[0].title, 'Mayhem')
  assert.equal(section.albums[0].chart, 'album')
  await registry.open(section.albums[0].id)
  assert.deepEqual(charts.opened, ['chart-ref'])
  await assert.rejects(registry.browse('plugin-charts', 'nope', new AbortController().signal), SourceError)
  // Providers' own categories no longer show on Explore.
  await assert.rejects(registry.browse('archive', 'trending', new AbortController().signal), SourceError)

  registry.setProviders([charts])
  assert.equal(registry.explore().canPlay, false)
})

test('charts are never searched', async () => {
  const registry = new ProviderRegistry()
  let searched = false
  registry.setProviders([
    fakeProvider('archive'),
    chartProvider({
      search: async () => {
        searched = true
        return { albums: [], songs: [] }
      }
    })
  ])
  const { sections } = await registry.search('q', new AbortController().signal)
  assert.deepEqual(
    sections.map(s => s.id),
    ['archive']
  )
  assert.equal(searched, false)
})

test('chart entries without a cover get one filled in', async () => {
  const asked: string[][] = []
  const registry = new ProviderRegistry(async albums => {
    asked.push(albums.map(a => a.title))
    return albums.map(a => (a.artwork ? a : { ...a, artwork: 'https://is1-ssl.mzstatic.com/x/600x600bb.jpg' }))
  })
  registry.setProviders([chartProvider()])
  const section = await registry.browse('plugin-charts', 'top', new AbortController().signal)
  assert.deepEqual(asked, [['Mayhem']])
  assert.equal(section.albums[0].artwork, 'https://is1-ssl.mzstatic.com/x/600x600bb.jpg')
})

test('a chart can be browsed for another country, and answers are kept for a while', async () => {
  const asked: Array<[string, number | undefined, string | undefined]> = []
  const regional = chartProvider({
    region: { current: 'gb', worldwide: true },
    browse: async (category, _signal, page, region) => {
      asked.push([category, page, region])
      return { albums: [{ ...album(`ref-${region}`, 'Song'), artist: 'Artist', chart: 'song' }], songs: [] }
    }
  })
  const registry = new ProviderRegistry()
  registry.setProviders([regional])
  const signal = new AbortController().signal
  assert.deepEqual(registry.explore().charts[0].region, { current: 'gb', worldwide: true })

  await registry.browse('plugin-charts', 'top', signal)
  await registry.browse('plugin-charts', 'top', signal, 1, 'in')
  await registry.browse('plugin-charts', 'top', signal, 1, '')
  // The same questions again come from memory.
  await registry.browse('plugin-charts', 'top', signal)
  await registry.browse('plugin-charts', 'top', signal, 1, 'in')
  assert.deepEqual(asked, [
    ['top', 1, undefined],
    ['top', 1, 'in'],
    ['top', 1, '']
  ])

  // Only real countries; worldwide only where the chart has it.
  for (const bad of ['xx', 'IN', 'india', 7, {}]) {
    await assert.rejects(registry.browse('plugin-charts', 'top', signal, 1, bad), SourceError)
  }
  const local = chartProvider({ region: { current: 'us', worldwide: false } })
  registry.setProviders([local])
  await assert.rejects(registry.browse('plugin-charts', 'top', signal, 1, ''), SourceError)
  // A chart with no country at all can't be given one.
  registry.setProviders([chartProvider()])
  await assert.rejects(registry.browse('plugin-charts', 'top', signal, 1, 'in'), SourceError)

  // Reconfiguring the plugins forgets what was kept; failures are never kept.
  registry.setProviders([regional])
  await registry.browse('plugin-charts', 'top', signal)
  assert.equal(asked.length, 4)
  let fails = 0
  registry.setProviders([
    chartProvider({
      browse: async () => {
        fails++
        throw new Error('down')
      }
    })
  ])
  await registry.browse('plugin-charts', 'top', signal)
  await registry.browse('plugin-charts', 'top', signal)
  assert.equal(fails, 2)
})

test('findRelease searches the torrent providers and opens the best match', async () => {
  const registry = new ProviderRegistry()
  const queries: string[] = []
  const tracker = fakeProvider('tracker', {
    search: async query => {
      queries.push(query)
      return {
        albums: [
          { ...album('karaoke', 'Lady Gaga - Mayhem Karaoke'), seeders: 900 },
          { ...album('flac', 'Lady Gaga - Mayhem (2025) [FLAC]'), seeders: 40 },
          { ...album('other', 'Lady Gaga - Chromatica'), seeders: 99 }
        ],
        songs: []
      }
    }
  })
  registry.setProviders([chartProvider(), tracker])

  const playable = await registry.findRelease({ kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' })
  assert.deepEqual(queries, ['Lady Gaga Mayhem'])
  assert.deepEqual(tracker.opened, ['flac'])
  assert.deepEqual(playable.hints, { title: 'Mayhem', artist: 'Lady Gaga' })
  assert.equal(playable.startAt, undefined)

  const forSong = await registry.findRelease({
    kind: 'song',
    title: 'Abracadabra',
    artist: 'Lady Gaga',
    album: 'Mayhem'
  })
  // The fake tracker answers every query with the album, so the first query is enough.
  assert.deepEqual(queries.slice(1), ['Lady Gaga Abracadabra'])
  assert.deepEqual(tracker.opened, ['flac', 'flac'])
  assert.deepEqual(forSong.startAt, { title: 'Abracadabra', artist: 'Lady Gaga' })
})

test('findRelease tries the next match when one fails, and explains when nothing is found', async () => {
  const registry = new ProviderRegistry()
  const flaky = fakeProvider('tracker', {
    search: async () => ({
      albums: [
        { ...album('broken', 'Drake - HABIBTI (FOMO) [FLAC]'), seeders: 80 },
        { ...album('works', 'Drake - HABIBTI (FOMO) [MP3]'), seeders: 5 }
      ],
      songs: []
    }),
    open: async a => {
      flaky.opened.push(a.ref)
      if (a.ref === 'broken') throw new Error('download failed')
      return { kind: 'torrent', torrent: `magnet:?xt=urn:btih:${'b'.repeat(40)}` }
    }
  })
  registry.setProviders([flaky])
  await registry.findRelease({ kind: 'album', title: 'HABIBTI (FOMO)', artist: 'Drake' })
  assert.deepEqual(flaky.opened, ['broken', 'works'])

  await assert.rejects(
    registry.findRelease({ kind: 'album', title: 'Nothing Like It', artist: 'Nobody' }),
    /Couldn’t find/
  )
  registry.setProviders([chartProvider()])
  await assert.rejects(
    registry.findRelease({ kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' }),
    /Turn on a provider/
  )
})

test('opening a chart entry goes through its provider', async () => {
  const registry = new ProviderRegistry()
  const charts = chartProvider()
  registry.setProviders([charts])
  const section = await registry.browse('plugin-charts', 'top', new AbortController().signal)
  await registry.open(section.albums[0].id)
  assert.deepEqual(charts.opened, ['chart-ref'])
})

test('search sections say when a provider has more, and searchMore pages one provider', async () => {
  const registry = new ProviderRegistry()
  const pages: Array<number | undefined> = []
  const paged = fakeProvider('torznab-1', {
    search: async (_query, _signal, page) => {
      pages.push(page)
      return { albums: [album(`p${page ?? 1}`, `Page ${page ?? 1}`)], songs: [], hasMore: (page ?? 1) < 2 }
    }
  })
  registry.setProviders([paged, chartProvider()])
  const { sections } = await registry.search('q', new AbortController().signal)
  assert.equal(sections[0].hasMore, true)

  const more = await registry.searchMore('torznab-1', 'q', 2, new AbortController().signal)
  assert.deepEqual(
    more.albums.map(a => a.title),
    ['Page 2']
  )
  assert.equal(more.hasMore, undefined)
  assert.deepEqual(pages, [undefined, 2])
  await registry.open(more.albums[0].id)
  assert.deepEqual(paged.opened, ['p2'])

  for (const bad of [0, 1.5, 21, '2', null]) {
    await assert.rejects(registry.searchMore('torznab-1', 'q', bad, new AbortController().signal), /page/)
  }
  await assert.rejects(
    registry.searchMore('plugin-charts', 'q', 2, new AbortController().signal),
    /no longer available/
  )
  await assert.rejects(registry.browse('plugin-charts', 'top', new AbortController().signal, 99), /page/)
})

test('a remembered song is opened again through its provider, without a search', async () => {
  const provider = fakeProvider('plugin-demo')
  const registry = new ProviderRegistry()
  registry.setProviders([provider])
  await registry.openStored('plugin-demo', 'abc 123')
  assert.deepEqual(provider.opened, ['{"id":"abc 123"}'])
  // A source that is off or removed says so, instead of failing obscurely.
  await assert.rejects(
    registry.openStored('plugin-gone', 'abc'),
    (err: Error) => err instanceof SourceError && /turned off or removed/.test(err.message)
  )
  // Charts can't play songs themselves.
  registry.setProviders([fakeProvider('plugin-chart', { chart: true })])
  await assert.rejects(registry.openStored('plugin-chart', 'abc'), SourceError)
})
