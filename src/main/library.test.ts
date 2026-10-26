import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLibrary, isAudioFileName, type TorrentFileInfo, titleFromFileName, trackKey } from './library.ts'

const files = (torrentName: string, entries: Array<[string, number]>): TorrentFileInfo[] =>
  entries.map(([p, length]) => ({ path: `${torrentName}/${p}`, length }))

test('archive.org style torrent: one track per song, preferring full-quality mp3', () => {
  const lib = buildLibrary(
    'nineinchnails_ghosts_I_IV',
    files('nineinchnails_ghosts_I_IV', [
      ['01_Ghosts_I.flac', 12_916_014],
      ['.____padding_file/0', 1_764_050],
      ['01_Ghosts_I.mp3', 3_801_088],
      ['01_Ghosts_I.ogg', 2_119_552],
      ['01_Ghosts_I.png', 12_052],
      ['01_Ghosts_I_320kb.mp3', 6_754_432],
      ['01_Ghosts_I_64kb.mp3', 1_351_389],
      ['01_Ghosts_I_vbr.mp3', 3_777_526],
      ['01_Ghosts_I_vbr.png', 11_894],
      ['02_Ghosts_I.flac', 15_145_706],
      ['02_Ghosts_I_64kb.mp3', 1_570_608],
      ['Ghosts_I-IV.jpg', 450_000],
      ['nineinchnails_ghosts_I_IV.zip', 900_000_000]
    ])
  )

  assert.equal(lib.title, 'nineinchnails ghosts I IV')
  assert.deepEqual(
    lib.tracks.map(t => [t.fileIndex, t.trackNo, t.title, t.format]),
    [
      [2, 1, 'Ghosts I', 'MP3'],
      [9, 2, 'Ghosts I', 'FLAC']
    ]
  )
  assert.equal(lib.coverIndex, 11)
})

test('common "Artist - Title" prefix becomes the artist', () => {
  const lib = buildLibrary(
    'Classical_Sampler-9615',
    files('Classical_Sampler-9615', [
      ['Classical_Sampler-9615.jpg', 38_944],
      ['Classical_Sampler-9615_thumb.jpg', 2_821],
      ['Kevin_MacLeod_-_Canon_in_D_Major.mp3', 11_851_012],
      ['Kevin_MacLeod_-_Canon_in_D_Major.png', 10_350],
      ['Kevin_MacLeod_-_Also_Sprach_Zarathustra.mp3', 3_445_220]
    ])
  )

  assert.equal(lib.artist, 'Kevin MacLeod')
  assert.deepEqual(
    lib.tracks.map(t => [t.title, t.artist]),
    [
      ['Also Sprach Zarathustra', 'Kevin MacLeod'],
      ['Canon in D Major', 'Kevin MacLeod']
    ]
  )
  assert.equal(lib.coverIndex, 0)
})

test('typical album folder: track numbers, natural order, cover.jpg, junk ignored', () => {
  const lib = buildLibrary(
    'Artist - Album (2004) [MP3]',
    files('Artist - Album (2004) [MP3]', [
      ['10 - Tenth.mp3', 5_000_000],
      ['02. Second.mp3', 5_000_000],
      ['1 - First.mp3', 5_000_000],
      ['__MACOSX/._1 - First.mp3', 4_000],
      ['._02. Second.mp3', 4_000],
      ['Scans/back.jpg', 2_000_000],
      ['cover.jpg', 300_000],
      ['info.nfo', 1_000]
    ])
  )

  assert.equal(lib.title, 'Artist - Album (2004) [MP3]')
  assert.deepEqual(
    lib.tracks.map(t => [t.trackNo, t.title]),
    [
      [1, 'First'],
      [2, 'Second'],
      [10, 'Tenth']
    ]
  )
  assert.equal(lib.coverIndex, 6)
})

test('titles that are only numbers are not mistaken for track numbers', () => {
  const lib = buildLibrary(
    'the_slip',
    files('the_slip', [
      ['01_999999.mp3', 1],
      ['02_1000000.mp3', 1]
    ])
  )
  assert.deepEqual(
    lib.tracks.map(t => [t.trackNo, t.title]),
    [
      [1, '999999'],
      [2, '1000000']
    ]
  )
})

test('multi-disc folders sort by disc, then track', () => {
  const lib = buildLibrary(
    'Box',
    files('Box', [
      ['CD2/01 - Disc Two Opener.flac', 1],
      ['CD1/02 - Second.flac', 1],
      ['CD1/01 - First.flac', 1]
    ])
  )
  assert.deepEqual(
    lib.tracks.map(t => t.title),
    ['First', 'Second', 'Disc Two Opener']
  )
})

test('single-file torrent uses the file name without extension as title', () => {
  const lib = buildLibrary('Some_Song.mp3', [{ path: 'Some_Song.mp3', length: 10 }])
  assert.equal(lib.title, 'Some Song')
  assert.equal(lib.tracks.length, 1)
})

test('track keys ignore the torrent folder, extension and derivative suffix', () => {
  const lib = buildLibrary(
    'Box',
    files('Box', [
      ['CD1/01_Song_vbr.mp3', 1],
      ['CD1/01_Song.flac', 1]
    ])
  )
  assert.deepEqual(
    lib.tracks.map(t => t.key),
    ['cd1/01_song']
  )
  assert.equal(trackKey('CD1\\01_Song_64kb.mp3'), 'cd1/01_song')
  assert.equal(trackKey('Single.mp3'), 'single')
})

test('filename helpers', () => {
  assert.equal(titleFromFileName('dir/02_letting_you_vbr.mp3'), 'letting you')
  assert.equal(isAudioFileName('a.FLAC'), true)
  assert.equal(isAudioFileName('a.shn'), false)
})

test('no playable audio yields no tracks', () => {
  const lib = buildLibrary(
    'movie',
    files('movie', [
      ['movie.mkv', 1],
      ['subs.srt', 1]
    ])
  )
  assert.equal(lib.tracks.length, 0)
  assert.equal(lib.coverIndex, undefined)
})
