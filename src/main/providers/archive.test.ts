import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  archiveIdFromTorrentUrl,
  buildQueries,
  createArchiveProvider,
  type JsonFetcher,
  licenseLabel,
  parseAlbums,
  parseArchiveFiles,
  parseLength,
  pickSongs,
  searchArchive,
  tokenize
} from './archive.ts'

const doc = (identifier: string, extra: Record<string, unknown> = {}) => ({ identifier, title: identifier, ...extra })
const searchResponse = (...docs: unknown[]) => ({ response: { numFound: docs.length, docs } })

const SLIP_FILES = {
  result: [
    {
      name: '01_999999.flac',
      source: 'original',
      title: '999,999',
      creator: 'Nine Inch Nails',
      album: 'The Slip',
      track: '01',
      length: '85.4'
    },
    { name: '01_999999.mp3', source: 'derivative', title: '999,999', creator: 'Nine Inch Nails', length: '01:25' },
    { name: '01_999999_64kb.mp3', source: 'derivative' },
    {
      name: '04_discipline.mp3',
      title: 'Discipline',
      creator: 'Nine Inch Nails',
      album: 'The Slip',
      track: '04',
      length: '04:19'
    },
    { name: '04_discipline.png', format: 'PNG' },
    { name: '__MACOSX/._04_discipline.mp3' },
    { name: 'nine_inch_nails_the_slip_meta.xml' }
  ]
}

test('tokenize keeps only letters and digits, so Lucene syntax cannot be injected', () => {
  assert.deepEqual(tokenize('  Beyoncé — "Halo" (Live) OR title:x* '), ['beyonce', 'halo', 'live', 'or', 'title', 'x'])
  assert.deepEqual(tokenize('a a b'), ['a', 'b'])
  assert.deepEqual(tokenize('!!!'), [])
})

test('buildQueries searches title/creator strictly, plus partial and broad fallbacks', () => {
  const q = buildQueries(['nine', 'inch', 'discipline'])
  assert.match(
    q.strict,
    /^\(title:\(nine\) OR creator:\(nine\)\) AND \(title:\(inch\) OR creator:\(inch\)\) AND \(title:\(discipline\)/
  )
  assert.match(q.strict, /mediatype:\(audio OR etree\)/)
  assert.match(q.broad, /^\(nine AND inch AND discipline\) AND /)
  assert.equal(q.partial.length, 2)
  assert.doesNotMatch(q.partial[0], /discipline/)
  assert.doesNotMatch(q.partial[1], /title:\(nine\)/)
  assert.deepEqual(buildQueries(['solo']).partial, [])
})

test('parseAlbums validates identifiers and normalises fields', () => {
  const albums = parseAlbums(
    searchResponse(
      doc('nine_inch_nails_the_slip', {
        title: 'The Slip',
        creator: ['Nine Inch Nails', 'Trent Reznor'],
        year: '2008',
        downloads: 82663,
        licenseurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/us/'
      }),
      doc('../../etc/passwd'),
      { title: 'no identifier' },
      doc('gd77-05-08.sbd', { date: '1977-05-08T00:00:00Z', downloads: 'lots' })
    )
  )
  assert.deepEqual(albums[0], {
    ref: 'nine_inch_nails_the_slip',
    title: 'The Slip',
    artist: 'Nine Inch Nails, Trent Reznor',
    year: '2008',
    license: 'CC BY-NC-SA',
    artwork: 'https://archive.org/services/img/nine_inch_nails_the_slip'
  })
  assert.equal(albums.length, 2)
  assert.equal(albums[1].year, '1977')
  assert.throws(() => parseAlbums({ error: 'nope' }))
})

test('parseArchiveFiles: one entry per song, tags preferred, junk skipped', () => {
  const files = parseArchiveFiles(SLIP_FILES)
  assert.deepEqual(
    files.map(f => [f.key, f.title, f.trackNo, f.duration]),
    [
      ['01_999999', '999,999', 1, 85.4],
      ['04_discipline', 'Discipline', 4, 259]
    ]
  )
  assert.deepEqual(parseArchiveFiles({}), [])
})

test('pickSongs requires every word and counts title hits', () => {
  const album = parseAlbums(
    searchResponse(doc('nine_inch_nails_the_slip', { title: 'The Slip', creator: 'Nine Inch Nails' }))
  )[0]
  const picked = pickSongs(album, SLIP_FILES, tokenize('nine inch nails discip'))
  assert.deepEqual(
    picked.map(p => [p.song.title, p.titleHits]),
    [['Discipline', 1]]
  )
  assert.equal(picked[0].song.key, '04_discipline')
  assert.equal(pickSongs(album, SLIP_FILES, tokenize('nine inch nails')).length, 2)
})

test('searchArchive merges album tiers and ranks title matches first', async () => {
  const calls: string[] = []
  const fetchJson: JsonFetcher = async url => {
    calls.push(url.pathname)
    if (url.pathname === '/advancedsearch.php') {
      const q = url.searchParams.get('q') ?? ''
      if (q.includes('title:(discipline)')) return searchResponse() // strict: nothing has "discipline" in title/creator
      if (q.startsWith('(nine AND')) return searchResponse(doc('freemusiccharts2008', { downloads: 5 }))
      return searchResponse(
        doc('nine_inch_nails_the_slip', { title: 'The Slip', creator: 'Nine Inch Nails', downloads: 9 })
      )
    }
    if (url.pathname === '/metadata/nine_inch_nails_the_slip/files') return SLIP_FILES
    return { result: [] }
  }

  const results = await searchArchive('Nine Inch Nails Discipline', fetchJson)
  assert.deepEqual(
    results.albums.map(a => a.ref),
    ['nine_inch_nails_the_slip', 'freemusiccharts2008']
  )
  assert.deepEqual(
    results.songs.map(s => s.title),
    ['Discipline']
  )
  assert.equal(calls.filter(p => p === '/advancedsearch.php').length, 4)
})

test('searchArchive fails only when every search request fails', async () => {
  const failing: JsonFetcher = async () => {
    throw new Error('offline')
  }
  await assert.rejects(searchArchive('anything', failing), /offline/)
  assert.deepEqual(await searchArchive('   ', failing), { songs: [], albums: [] })
})

test('small helpers', () => {
  assert.equal(licenseLabel('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0')
  assert.equal(licenseLabel('http://creativecommons.org/publicdomain/mark/1.0/'), 'Public domain')
  assert.equal(licenseLabel(undefined), undefined)
  assert.equal(parseLength('1:02:03'), 3723)
  assert.equal(parseLength('soon'), undefined)
  assert.equal(archiveIdFromTorrentUrl('https://archive.org/download/NS050/NS050_archive.torrent'), 'NS050')
  assert.equal(archiveIdFromTorrentUrl('https://archive.org/download/a/b_archive.torrent'), undefined)
  assert.equal(archiveIdFromTorrentUrl('https://evil.example/download/a/a_archive.torrent'), undefined)
})

test('pickSongs marks songs matched only through the album title as indirect', () => {
  const album = parseAlbums(searchResponse(doc('sb-live', { title: 'Scarlet Begonias Live', creator: 'Some Band' })))[0]
  const files = {
    result: [
      { name: '01.mp3', title: 'Sugaree' },
      { name: '02.mp3', title: 'Scarlet Begonias' }
    ]
  }
  assert.deepEqual(
    pickSongs(album, files, tokenize('scarlet begonias')).map(p => [p.song.title, p.direct]),
    [
      ['Sugaree', false],
      ['Scarlet Begonias', true]
    ]
  )
})

test('stopwords do not count as title hits', () => {
  const album = parseAlbums(searchResponse(doc('slip', { title: 'The Slip', creator: 'Nine Inch Nails' })))[0]
  const files = {
    result: [
      { name: '01.mp3', title: '999,999' },
      { name: '09.mp3', title: 'Lights in the Sky' }
    ]
  }
  assert.deepEqual(
    pickSongs(album, files, tokenize('the slip')).map(p => [p.song.title, p.titleHits]),
    [
      ['999,999', 0],
      ['Lights in the Sky', 0]
    ]
  )
})

test('archive provider opens an item as its torrent plus tag annotations', async () => {
  const fetched: string[] = []
  const provider = createArchiveProvider({
    fetchJson: async url => (url.pathname.endsWith('/files') ? SLIP_FILES : searchResponse()),
    fetchTorrent: async url => {
      fetched.push(url)
      return new Uint8Array([1, 2, 3])
    }
  })
  const playable = await provider.open({ ref: 'nine_inch_nails_the_slip', title: 'The Slip' })
  assert.deepEqual(fetched, [
    'https://archive.org/download/nine_inch_nails_the_slip/nine_inch_nails_the_slip_archive.torrent'
  ])
  assert.equal((await playable.annotations)?.get('04_discipline')?.title, 'Discipline')
  await assert.rejects(provider.open({ ref: '../evil', title: 'x' }))
})
