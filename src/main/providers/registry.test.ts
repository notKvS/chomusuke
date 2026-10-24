import { test } from 'node:test'
import assert from 'node:assert/strict'
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
    search: async () => ({ albums: [album(`${id}-secret-locator`, 'An Album')], songs: [{ key: '01_song', title: 'Song', album: album(`${id}-other`) }] }),
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

  assert.deepEqual(results.sections.map(s => [s.id, s.name, s.albums.length]), [
    ['archive', 'ARCHIVE', 1],
    ['torznab-1', 'TORZNAB-1', 1]
  ])
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
  assert.deepEqual(registry.explore(), [{ id: 'archive', name: 'ARCHIVE', layout: 'cards', categories: [{ id: 'trending', name: 'Trending' }] }])

  const section = await registry.browse('archive', 'trending', new AbortController().signal)
  assert.equal(section.albums[0].title, 'Hot')
  await registry.open(section.albums[0].id)
  assert.deepEqual(browsable.opened, ['hot-locator'])
  await assert.rejects(registry.browse('archive', 'nope', new AbortController().signal), SourceError)
  await assert.rejects(registry.browse('torznab-1', 'trending', new AbortController().signal), SourceError)
})
