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

test('explore lists browsable providers and browse remembers results', async () => {
  const registry = new ProviderRegistry()
  const browsable = fakeProvider('archive', {
    categories: [{ id: 'trending', name: 'Trending' }],
    browse: async () => ({ albums: [album('hot-locator', 'Hot')], songs: [] })
  })
  registry.setProviders([browsable, fakeProvider('torznab-1')])
  assert.deepEqual(registry.explore(), [
    { id: 'archive', name: 'ARCHIVE', layout: 'cards', categories: [{ id: 'trending', name: 'Trending' }] }
  ])

  const section = await registry.browse('archive', 'trending', new AbortController().signal)
  assert.equal(section.albums[0].title, 'Hot')
  await registry.open(section.albums[0].id)
  assert.deepEqual(browsable.opened, ['hot-locator'])
  await assert.rejects(registry.browse('archive', 'nope', new AbortController().signal), SourceError)
  await assert.rejects(registry.browse('torznab-1', 'trending', new AbortController().signal), SourceError)
})

const chartProvider = (behaviour: Partial<MusicProvider> = {}) =>
  fakeProvider('ext-charts', {
    chart: true,
    categories: [{ id: 'top', name: 'Top' }],
    browse: async () => ({
      albums: [{ ...album('chart-ref', 'Mayhem'), artist: 'Lady Gaga', chart: 'album' }],
      songs: []
    }),
    ...behaviour
  })

test('charts are listed first on Explore and never searched', async () => {
  const registry = new ProviderRegistry()
  let searched = false
  registry.setProviders([
    fakeProvider('archive', {
      categories: [{ id: 'trending', name: 'Trending' }],
      browse: async () => ({ albums: [], songs: [] })
    }),
    chartProvider({
      search: async () => {
        searched = true
        return { albums: [], songs: [] }
      }
    })
  ])
  assert.deepEqual(
    registry.explore().map(s => [s.id, s.chart]),
    [
      ['ext-charts', true],
      ['archive', undefined]
    ]
  )
  const { sections } = await registry.search('q', new AbortController().signal)
  assert.deepEqual(
    sections.map(s => s.id),
    ['archive']
  )
  assert.equal(searched, false)
  const section = await registry.browse('ext-charts', 'top', new AbortController().signal)
  assert.equal(section.albums[0].chart, 'album')
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
    /Turn on a torrent source/
  )
})

test('opening a chart entry goes through its provider', async () => {
  const registry = new ProviderRegistry()
  const charts = chartProvider()
  registry.setProviders([charts])
  const section = await registry.browse('ext-charts', 'top', new AbortController().signal)
  await registry.open(section.albums[0].id)
  assert.deepEqual(charts.opened, ['chart-ref'])
})
