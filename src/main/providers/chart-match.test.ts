import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChartWanted, chartQueries, findTrack, primaryArtist, rankReleases, scoreRelease } from './chart-match.ts'
import type { ProviderAlbum } from './types.ts'

const release = (title: string, extra: Partial<ProviderAlbum> = {}): ProviderAlbum => ({ ref: title, title, ...extra })
const album: ChartWanted = { kind: 'album', title: 'HABIBTI (FOMO)', artist: 'Drake' }
const song: ChartWanted = { kind: 'song', title: 'Die With A Smile', artist: 'Lady Gaga & Bruno Mars', album: 'Mayhem' }

test('primaryArtist takes the first credited artist', () => {
  assert.equal(primaryArtist('Lady Gaga & Bruno Mars'), 'Lady Gaga')
  assert.equal(primaryArtist('Calvin Harris x Dua Lipa'), 'Calvin Harris')
  assert.equal(primaryArtist('Travis Scott feat. Drake'), 'Travis Scott')
  assert.equal(primaryArtist('Drake'), 'Drake')
})

test('chartQueries: specific first, store suffixes and edition tags dropped, no duplicates', () => {
  assert.deepEqual(chartQueries(album), ['Drake HABIBTI FOMO'])
  assert.deepEqual(
    chartQueries({ kind: 'album', title: 'Thriller 25 (Super Deluxe Edition)', artist: 'Michael Jackson' }),
    ['Michael Jackson Thriller 25']
  )
  assert.deepEqual(chartQueries(song), [
    'Lady Gaga & Bruno Mars Die With A Smile',
    'Lady Gaga Mayhem',
    'Lady Gaga Die With A Smile'
  ])
  assert.deepEqual(chartQueries({ kind: 'song', title: 'Espresso - Single', artist: 'Sabrina Carpenter' }), [
    'Sabrina Carpenter Espresso'
  ])
})

test('scoreRelease accepts real releases of the album, whatever the naming', () => {
  for (const name of [
    'Drake - HABIBTI (FOMO) (2026) [FLAC 24-96]',
    'Drake-HABIBTI_FOMO-WEB-2026',
    'Drake – Habibti (FOMO) [320]'
  ]) {
    assert.notEqual(scoreRelease(album, release(name)), undefined, name)
  }
  assert.notEqual(scoreRelease(album, release('HABIBTI (FOMO)', { artist: 'Drake' })), undefined)
  // "Taylor's" in the chart, "Taylors" in the release name
  assert.notEqual(
    scoreRelease(
      { kind: 'album', title: "1989 (Taylor's Version)", artist: 'Taylor Swift' },
      release('Taylor Swift - 1989 (Taylors Version) (2023) [FLAC]')
    ),
    undefined
  )
})

test('the release must be by the credited artist, not someone sharing a word of the name', () => {
  const by = (artist: string, title: string, name: ProviderAlbum) =>
    scoreRelease({ kind: 'album', title, artist }, name) !== undefined
  // Same title, different artist
  assert.equal(
    by('Simon & Garfunkel', 'Bridge Over Troubled Water', release('Paul Simon - Bridge Over Troubled Water Live')),
    false
  )
  assert.equal(by('Tyler, The Creator', 'CHROMAKOPIA', release('Chromakopia', { artist: 'Bonnie Tyler' })), false)
  assert.equal(by('Lady Gaga', 'Mayhem', release('Mayhem', { artist: 'Lady Sovereign' })), false)
  assert.equal(
    scoreRelease(
      { kind: 'song', title: 'Timeless', artist: 'The Weeknd & Playboi Carti' },
      release('Timeless - The Best Of', { artist: 'Goldie' })
    ),
    undefined
  )
  // …while the real ones, named either way round, still match
  assert.equal(
    by(
      'Simon & Garfunkel',
      'Bridge Over Troubled Water',
      release('Simon & Garfunkel - Bridge Over Troubled Water (1970) [FLAC]')
    ),
    true
  )
  assert.equal(by('Tyler, The Creator', 'CHROMAKOPIA', release('Tyler, The Creator - CHROMAKOPIA (2024)')), true)
  assert.equal(by('Florence + The Machine', 'Dance Fever', release('Florence and the Machine - Dance Fever')), true)
  assert.equal(by('Nirvana', 'Nevermind', release('Nevermind - Nirvana')), true)
  assert.equal(
    scoreRelease(
      { kind: 'song', title: 'Timeless', artist: 'The Weeknd & Playboi Carti', album: 'Hurry Up Tomorrow' },
      release('The Weeknd - Hurry Up Tomorrow (2025) [FLAC]')
    ) !== undefined,
    true
  )
  const ranked = rankReleases({ kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' }, [
    { album: release('Mayhem', { artist: 'Lady Sovereign', seeders: 5000 }) },
    { album: release('Lady Gaga - Mayhem [FLAC]', { seeders: 2 }) }
  ])
  assert.deepEqual(
    ranked.map(c => c.album.title),
    ['Lady Gaga - Mayhem [FLAC]']
  )
})

test('scoreRelease rejects other artists, other albums, knock-offs and dead torrents', () => {
  assert.equal(scoreRelease(album, release('Future - HABIBTI (FOMO)')), undefined)
  assert.equal(scoreRelease(album, release('Drake - For All The Dogs (2023)')), undefined)
  assert.equal(scoreRelease(album, release('Drake - HABIBTI (FOMO) Karaoke Version')), undefined)
  assert.equal(scoreRelease(album, release('Tribute to Drake - HABIBTI (FOMO)')), undefined)
  assert.equal(scoreRelease(album, release('Drake - HABIBTI (FOMO)', { seeders: 0 })), undefined)
  // …unless the chart entry is itself that kind of release
  const instrumental: ChartWanted = { kind: 'album', title: 'Instrumentals', artist: 'Nujabes' }
  assert.notEqual(scoreRelease(instrumental, release('Nujabes - Instrumentals')), undefined)
})

test('a song is found as a single, in its album, or in a discography', () => {
  assert.notEqual(scoreRelease(song, release('Lady Gaga, Bruno Mars - Die With A Smile (2024) [24Bit]')), undefined)
  assert.notEqual(scoreRelease(song, release('Lady Gaga - Mayhem (2025) [FLAC]')), undefined)
  assert.notEqual(scoreRelease(song, release('Lady Gaga - Discography 2008-2025 [MP3]')), undefined)
  assert.equal(scoreRelease(song, release('Lady Gaga - Chromatica (2020)')), undefined)
})

test('rankReleases prefers exact names with seeders; discographies come after the album', () => {
  const candidates = [
    release('Lady Gaga - Discography 2008-2025 [MP3]', { seeders: 300 }),
    release('Lady Gaga - Mayhem (2025) [FLAC]', { seeders: 40 }),
    release('Lady Gaga - Mayhem (2025) [MP3 320]', { seeders: 3 }),
    release('Lady Gaga - Mayhem Karaoke', { seeders: 900 }),
    release('Bruno Mars - 24K Magic', { seeders: 500 })
  ].map(album => ({ album }))
  assert.deepEqual(
    rankReleases(song, candidates).map(c => c.album.title),
    [
      'Lady Gaga - Mayhem (2025) [FLAC]',
      'Lady Gaga - Mayhem (2025) [MP3 320]',
      'Lady Gaga - Discography 2008-2025 [MP3]'
    ]
  )
  const busier = rankReleases(album, [
    { album: release('Drake - HABIBTI (FOMO) [FLAC]', { seeders: 2 }) },
    { album: release('Drake - HABIBTI (FOMO) [MP3]', { seeders: 200 }) }
  ])
  assert.equal(busier[0].album.title, 'Drake - HABIBTI (FOMO) [MP3]')
})

test('findTrack finds the song by title, despite numbers, prefixes and tags', () => {
  const tracks = [
    { key: 'Mayhem/01 Disease', title: '01 Disease' },
    { key: 'Mayhem/02 Abracadabra', title: '02. Abracadabra' },
    { key: 'Mayhem/14 Die With A Smile', title: 'Lady Gaga - Die With A Smile (feat. Bruno Mars)' },
    { key: 'Mayhem/15 Die With A Smile Live', title: 'Die With A Smile (Live)' }
  ]
  assert.equal(
    findTrack(tracks, { title: 'Die With A Smile', artist: 'Lady Gaga & Bruno Mars' }),
    'Mayhem/14 Die With A Smile'
  )
  assert.equal(findTrack(tracks, { title: 'Abracadabra', artist: 'Lady Gaga' }), 'Mayhem/02 Abracadabra')
  assert.equal(
    findTrack([{ key: 'a', title: 'Espresso', artist: 'Sabrina Carpenter' }], {
      title: 'Espresso - Single',
      artist: 'Sabrina Carpenter'
    }),
    'a'
  )
  assert.equal(findTrack(tracks, { title: 'Bad Romance', artist: 'Lady Gaga' }), undefined)
  // A same-titled song by someone else on a compilation isn't it
  assert.equal(
    findTrack(
      [
        { key: 'a', title: 'Timeless', artist: 'Goldie' },
        { key: 'b', title: 'Timeless', artist: 'The Weeknd, Playboi Carti' }
      ],
      { title: 'Timeless', artist: 'The Weeknd & Playboi Carti' }
    ),
    'b'
  )
})
