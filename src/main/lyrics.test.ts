import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseLyrics, LyricsFinder, parseLrc } from './lyrics.ts'

const LRC = `[ar:Daft Punk]
[ti:Get Lucky]
[offset:+500]
[00:12.50] We've come too far
[00:15.00]To give up who we are
[00:18.20][01:02.40] Get lucky <00:18.80>again
[00:20.00]
not a lyric line`

test('parses LRC: stamps, repeated lines, offset, word tags and metadata', () => {
  assert.deepEqual(parseLrc(LRC), [
    { time: 12, text: "We've come too far" },
    { time: 14.5, text: 'To give up who we are' },
    { time: 17.7, text: 'Get lucky again' },
    { time: 19.5, text: '' },
    { time: 61.9, text: 'Get lucky again' }
  ])
  assert.deepEqual(parseLrc('[01:05:50]x'), [{ time: 65.5, text: 'x' }])
  assert.deepEqual(parseLrc('no stamps at all'), [])
})

const record = (extra: Record<string, unknown>) => ({
  trackName: 'Get Lucky',
  artistName: 'Daft Punk',
  duration: 369,
  instrumental: false,
  plainLyrics: "We've come too far\nTo give up who we are",
  syncedLyrics: "[00:12.00] We've come too far\n[00:15.00] To give up who we are",
  ...extra
})
const QUERY = { title: 'Get Lucky', artist: 'Daft Punk', duration: 369 }

test('synced lyrics of a recording of about the same length are preferred, the closest first', () => {
  const lyrics = chooseLyrics(
    [
      record({ duration: 375, syncedLyrics: '[00:01.00] too far off' }),
      record({ duration: 371, syncedLyrics: '[00:02.00] close' }),
      record({ duration: 369, syncedLyrics: '[00:03.00] exact' })
    ],
    QUERY
  )
  assert.equal(lyrics?.synced, true)
  assert.deepEqual(lyrics?.lines, [{ time: 3, text: 'exact' }])
})

test('without a fitting synced record, the words are shown plain', () => {
  const lyrics = chooseLyrics([record({ duration: 520, syncedLyrics: '[00:01.00] live version' })], QUERY)
  assert.equal(lyrics?.synced, false)
  assert.deepEqual(lyrics?.lines, [{ text: "We've come too far" }, { text: 'To give up who we are' }])
  // Only synced text on record: the stamps come off.
  const stripped = chooseLyrics(
    [record({ plainLyrics: null, duration: 520, syncedLyrics: '[00:01.00] only synced\n[00:04.00] words' })],
    QUERY
  )
  assert.deepEqual(stripped?.lines, [{ text: 'only synced' }, { text: 'words' }])
})

test('only the same song counts: artist and title must fit, not just resemble', () => {
  const others = [
    record({ artistName: 'Someone Else' }),
    record({ trackName: 'Get Lucky (Karaoke)', artistName: 'Daft Punk' }),
    record({ trackName: 'Lucky', artistName: 'Daft Punk' })
  ]
  assert.equal(chooseLyrics(others, QUERY), null)
  // Edition tags and guests on either side are ignored.
  assert.notEqual(
    chooseLyrics([record({ trackName: 'Get Lucky - Radio Edit' })], { ...QUERY, title: 'Get Lucky (feat. Pharrell)' }),
    null
  )
})

test('an instrumental, and a song with no words anywhere', () => {
  assert.deepEqual(chooseLyrics([record({ instrumental: true, plainLyrics: null, syncedLyrics: null })], QUERY), {
    lines: [],
    synced: false,
    instrumental: true,
    source: 'LRCLIB'
  })
  assert.equal(chooseLyrics([record({ plainLyrics: '', syncedLyrics: null })], QUERY), null)
  assert.equal(chooseLyrics([], QUERY), null)
  assert.equal(chooseLyrics(['junk', null, 5], QUERY), null)
})

test('the finder searches by track and artist, then by a free-text query, and remembers answers', async () => {
  const asked: string[] = []
  const finder = new LyricsFinder(async url => {
    asked.push(url.search)
    return url.searchParams.has('q') ? [record({})] : []
  })
  const lyrics = await finder.find({ title: '03 - Get Lucky', artist: 'Daft Punk', duration: 369 })
  assert.equal(lyrics?.synced, true)
  assert.deepEqual(asked, ['?track_name=Get+Lucky&artist_name=Daft+Punk', '?q=Daft+Punk+Get+Lucky'])
  await finder.find({ title: 'Get Lucky', artist: 'Daft Punk', duration: 370 })
  assert.equal(asked.length, 2) // from memory

  // "No lyrics" is remembered too, a failing service is not.
  let calls = 0
  const empty = new LyricsFinder(async () => {
    calls++
    return []
  })
  assert.equal(await empty.find({ title: 'Obscure Song', artist: 'Nobody' }), null)
  await empty.find({ title: 'Obscure Song', artist: 'Nobody' })
  assert.equal(calls, 2) // both searches, once

  let up = false
  const flaky = new LyricsFinder(async () => {
    if (!up) throw new Error('down')
    return [record({})]
  })
  await assert.rejects(flaky.find(QUERY))
  up = true
  assert.notEqual(await flaky.find(QUERY), null)
})

test('a generic title is not looked up, and without an artist only the title is searched', async () => {
  let calls = 0
  const finder = new LyricsFinder(async url => {
    calls++
    assert.equal(url.searchParams.get('q'), 'Get Lucky')
    return [record({})]
  })
  assert.equal(await finder.find({ title: 'Track 01' }), null)
  assert.equal(calls, 0)
  assert.notEqual(await finder.find({ title: 'Get Lucky' }), null)
  assert.equal(calls, 1)
})
