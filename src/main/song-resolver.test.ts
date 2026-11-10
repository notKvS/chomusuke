import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Album, SongRef, Track } from '../shared/types.ts'
import type { HttpPlayable, MusicProvider, Playable, ProviderAlbum } from './providers/types.ts'
import { SongResolver, type SongSources } from './song-resolver.ts'
import { SourceError } from './source.ts'

const track = (key: string, title: string, extra: Partial<Track> = {}): Track => ({
  id: key,
  key,
  fileIndex: 0,
  title,
  format: 'MP3',
  size: 0,
  url: '',
  ...extra
})
const album = (id: string, title: string, tracks: Track[], source?: 'http'): Album => ({
  infoHash: id.padEnd(40, '0'),
  source,
  title,
  tracks,
  totalSize: 0
})

const MAGNET = `magnet:?xt=urn:btih:${'a'.repeat(40)}`

/** What opening each thing gives, by http id or magnet. */
const albums = new Map<string, Album>()
const opened: string[] = []

const httpPlayable = (id: string): HttpPlayable => ({
  kind: 'http',
  id: id.padEnd(40, '0'),
  origin: { provider: 'x', id },
  title: id,
  tracks: []
})
const torrentPlayable = (id: string): Playable => ({ kind: 'torrent', torrent: `magnet:?xt=urn:btih:${id}` })

interface Fake {
  id: string
  name: string
  delivery?: 'http'
  /** Results by query; every query gets these */
  results?: ProviderAlbum[]
  fail?: boolean
}

function provider(fake: Fake): MusicProvider & { searched: string[] } {
  const searched: string[] = []
  return {
    id: fake.id,
    name: fake.name,
    layout: 'cards',
    delivery: fake.delivery,
    searched,
    search: async query => {
      searched.push(query)
      if (fake.fail) throw new Error('down')
      return { albums: fake.results ?? [], songs: [] }
    },
    open: async a => {
      // A stored song is asked for by `{"id": …}`; a search result by its own ref.
      const ref = a.ref.startsWith('{') ? String(JSON.parse(a.ref).id) : a.ref
      opened.push(`${fake.id}:${ref}`)
      return fake.delivery === 'http' ? httpPlayable(ref) : torrentPlayable(ref)
    }
  }
}

function resolver(providers: MusicProvider[], magnets: Record<string, Album | Error> = {}) {
  const sources: SongSources = {
    providersOf: delivery => providers.filter(p => (p.delivery ?? 'torrent') === delivery),
    provider: id => providers.find(p => p.id === id)
  }
  return new SongResolver(sources, {
    magnet: async magnet => {
      const found = magnets[magnet]
      if (!found || found instanceof Error) throw found ?? new Error('no peers')
      return found
    },
    playable: async playable => {
      const key = playable.kind === 'http' ? playable.id : String(playable.torrent)
      const found = albums.get(key) ?? albums.get(key.replace(/0+$/, ''))
      if (!found) throw new Error(`nothing for ${key}`)
      return found
    }
  })
}

const HTTP_SONG: SongRef = {
  id: 'x',
  infoHash: 'b'.repeat(40),
  key: '1-get-lucky',
  title: 'Get Lucky',
  artist: 'Daft Punk',
  album: 'Random Access Memories',
  duration: 369,
  http: { provider: 'plugin-youtube-music', id: 'vid1' }
}
const TORRENT_SONG: SongRef = { ...HTTP_SONG, http: undefined, key: 'disc/08 get lucky', magnet: MAGNET }
delete (TORRENT_SONG as { http?: unknown }).http

const exact = (ref: string): ProviderAlbum => ({ ref, title: 'Get Lucky', artist: 'Daft Punk' })

const setup = () => {
  albums.clear()
  opened.length = 0
}

test('a song opens from where it was saved, with no notice', async () => {
  setup()
  albums.set('vid1', album('vid1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  const yt = provider({ id: 'plugin-youtube-music', name: 'YouTube Music', delivery: 'http' })
  const resolved = await resolver([yt]).resolve(HTTP_SONG)
  assert.equal(resolved.startKey, '1-get-lucky')
  assert.equal(resolved.notice, undefined)
  assert.deepEqual(yt.searched, []) // no search needed
})

test('a torrent song opens from its magnet link first', async () => {
  setup()
  const rams = album('ram', 'Random Access Memories', [
    track('disc/07 giorgio', 'Giorgio'),
    track('disc/08 get lucky', 'Get Lucky')
  ])
  const resolved = await resolver([], { [MAGNET]: rams }).resolve(TORRENT_SONG)
  assert.equal(resolved.startKey, 'disc/08 get lucky')
  assert.equal(resolved.notice, undefined)
})

test('when the plugin it was saved from is off, another streaming plugin with the exact song plays it, and says so', async () => {
  setup()
  albums.set('sc-1', album('sc-1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky', { duration: 367 })], 'http'))
  const soundcloud = provider({
    id: 'plugin-soundcloud',
    name: 'SoundCloud',
    delivery: 'http',
    results: [exact('sc-1')]
  })
  const resolved = await resolver([soundcloud]).resolve(HTTP_SONG)
  assert.equal(resolved.startKey, '1-get-lucky')
  assert.equal(resolved.notice, 'Youtube Music is turned off, so “Get Lucky” is playing from SoundCloud.')
})

test('streaming plugins are tried in the user’s order: the first one that has the exact song wins, others are skipped', async () => {
  setup()
  albums.set('a-1', album('a-1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  albums.set('c-1', album('c-1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  const first = provider({ id: 'plugin-first', name: 'First', delivery: 'http', results: [] })
  const second = provider({ id: 'plugin-second', name: 'Second', delivery: 'http', results: [exact('a-1')] })
  const third = provider({ id: 'plugin-third', name: 'Third', delivery: 'http', results: [exact('c-1')] })
  const resolved = await resolver([first, second, third]).resolve(HTTP_SONG)
  assert.match(resolved.notice ?? '', /playing from Second\.$/)
  assert.deepEqual(opened, ['plugin-second:a-1'])
})

test('a result is only the song when artist, title, track and length all fit', async () => {
  setup()
  albums.set('other', album('other', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  albums.set('live', album('live', 'Get Lucky', [track('1-get-lucky', 'Get Lucky', { duration: 520 })], 'http'))
  albums.set('wrong-track', album('wrong-track', 'Get Lucky', [track('1-other', 'Something Else')], 'http'))
  const results = [
    { ref: 'other', title: 'Get Lucky', artist: 'Someone Else' }, // wrong artist
    { ref: 'karaoke', title: 'Get Lucky (Karaoke Version)', artist: 'Daft Punk' }, // not the artist's own
    { ref: 'live', title: 'Get Lucky', artist: 'Daft Punk' }, // 2.5 minutes too long
    { ref: 'wrong-track', title: 'Get Lucky', artist: 'Daft Punk' } // opens to another song
  ]
  const only = provider({ id: 'plugin-only', name: 'Only', delivery: 'http', results })
  await assert.rejects(resolver([only]).resolve(HTTP_SONG), SourceError)
  assert.deepEqual(opened, ['plugin-only:live', 'plugin-only:wrong-track'])
})

const MORE = 'Turn on other plugins in Settings → Plugins to search them too.'

test('when nothing is found, the message asks to turn on other plugins, whichever kinds are on', async () => {
  setup()
  const wanted = `Couldn’t find “Get Lucky” by Daft Punk on your enabled plugins. ${MORE}`
  const streaming = provider({ id: 'plugin-soundcloud', name: 'SoundCloud', delivery: 'http', results: [] })
  await assert.rejects(resolver([streaming]).resolve(HTTP_SONG), (err: Error) => {
    assert.ok(err instanceof SourceError)
    assert.equal(err.message, wanted)
    return true
  })
  const archive = provider({ id: 'archive', name: 'Internet Archive', results: [] })
  await assert.rejects(resolver([archive]).resolve(TORRENT_SONG), (err: Error) => err.message === wanted)
  await assert.rejects(resolver([streaming, archive]).resolve(HTTP_SONG), (err: Error) => err.message === wanted)
  await assert.rejects(resolver([]).resolve(HTTP_SONG), (err: Error) => /No plugins are turned on/.test(err.message))
})

test('a streaming song with no streaming match is searched for among the torrent plugins by artist and title, and says the source changed', async () => {
  setup()
  const rams = album('rams', 'Daft Punk - Random Access Memories', [
    track('01 give life back to music', 'Give Life Back to Music'),
    track('08 get lucky', 'Get Lucky')
  ])
  albums.set(`magnet:?xt=urn:btih:rams`, rams)
  const torrents = provider({
    id: 'tpb',
    name: 'The Pirate Bay',
    results: [
      { ref: 'tribute', title: 'Daft Punk Tribute - Random Access Memories', artist: 'Daft Punk', seeders: 50 },
      { ref: 'dead', title: 'Daft Punk - Random Access Memories [FLAC]', artist: 'Daft Punk', seeders: 0 },
      { ref: 'rams', title: 'Daft Punk - Random Access Memories [FLAC]', artist: 'Daft Punk', seeders: 120 }
    ]
  })
  const soundcloud = provider({ id: 'plugin-soundcloud', name: 'SoundCloud', delivery: 'http', results: [] })
  const resolved = await resolver([soundcloud, torrents]).resolve(HTTP_SONG)
  assert.equal(resolved.startKey, '08 get lucky')
  assert.equal(resolved.notice, 'Youtube Music is turned off, so “Get Lucky” is playing from The Pirate Bay.')
  assert.deepEqual(opened, ['tpb:rams']) // the tribute and the dead torrent were never opened
  // Streaming plugins were asked first.
  assert.ok(soundcloud.searched.length > 0)
})

test('a torrent that won’t load is replaced by another source of the song', async () => {
  setup()
  albums.set('sc-1', album('sc-1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  const soundcloud = provider({
    id: 'plugin-soundcloud',
    name: 'SoundCloud',
    delivery: 'http',
    results: [exact('sc-1')]
  })
  const resolved = await resolver([soundcloud], { [MAGNET]: new Error('no peers') }).resolve(TORRENT_SONG)
  assert.equal(resolved.notice, 'The torrent for “Get Lucky” didn’t load, so it’s playing from SoundCloud.')
})

test('a plugin that fails to search is skipped, and the next one is used', async () => {
  setup()
  albums.set('sc-1', album('sc-1', 'Get Lucky', [track('1-get-lucky', 'Get Lucky')], 'http'))
  const broken = provider({ id: 'plugin-broken', name: 'Broken', delivery: 'http', fail: true })
  const working = provider({ id: 'plugin-working', name: 'Working', delivery: 'http', results: [exact('sc-1')] })
  const resolved = await resolver([broken, working]).resolve(HTTP_SONG)
  assert.match(resolved.notice ?? '', /playing from Working\.$/)
})
