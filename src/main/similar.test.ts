import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSimilarSongs, pickSongs, recordingsFromRadio, type SimilarSong, songsFromMetadata } from './similar.ts'

// Trimmed from real ListenBrainz answers for Radiohead (a74b1b7f-…).
const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const DAFT_PUNK = '056e4f3e-d505-4dad-8ec1-d04f521cbb56'
const MASSIVE_ATTACK = '10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8'
const rec = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const radio = {
  [DAFT_PUNK]: [
    {
      recording_mbid: rec(1),
      similar_artist_mbid: DAFT_PUNK,
      similar_artist_name: 'Daft Punk',
      total_listen_count: 171
    },
    {
      recording_mbid: rec(2),
      similar_artist_mbid: DAFT_PUNK,
      similar_artist_name: 'Daft Punk',
      total_listen_count: 395543
    },
    {
      recording_mbid: rec(3),
      similar_artist_mbid: DAFT_PUNK,
      similar_artist_name: 'Daft Punk',
      total_listen_count: 1399
    }
  ],
  [MASSIVE_ATTACK]: [
    {
      recording_mbid: rec(4),
      similar_artist_mbid: MASSIVE_ATTACK,
      similar_artist_name: 'Massive Attack',
      total_listen_count: 863711
    },
    { recording_mbid: 'not-an-id', similar_artist_mbid: MASSIVE_ATTACK, total_listen_count: 999999 }
  ],
  [RADIOHEAD]: [
    {
      recording_mbid: rec(5),
      similar_artist_mbid: RADIOHEAD,
      similar_artist_name: 'Radiohead',
      total_listen_count: 4311
    }
  ]
}

const meta = (title: string, artist: string, release?: Record<string, unknown>) => ({
  artist: { name: artist, artists: [{ name: artist }] },
  recording: { name: title, length: 228266 },
  ...(release ? { release } : {})
})

const metadata = {
  [rec(2)]: meta('One More Time', 'Daft Punk', {
    name: 'Discovery',
    caa_id: 44358089765,
    caa_release_mbid: 'fc312bd8-511a-4b49-9250-f60ad2fe0bcf'
  }),
  [rec(3)]: meta('Around the World', 'Daft Punk', { name: 'Homework', caa_id: 'oops', caa_release_mbid: 'x' }),
  [rec(4)]: meta('Teardrop', 'Massive Attack', { name: 'Mezzanine' }),
  [rec(5)]: meta('Creep', 'Radiohead')
}

test('LB Radio recordings: the most played of each artist first, in turns, rare ones and bad ids left out', () => {
  assert.deepEqual(recordingsFromRadio(radio), [
    { mbid: rec(2), artistMbid: DAFT_PUNK },
    { mbid: rec(4), artistMbid: MASSIVE_ATTACK },
    { mbid: rec(5), artistMbid: RADIOHEAD },
    { mbid: rec(3), artistMbid: DAFT_PUNK }
  ])
  assert.deepEqual(recordingsFromRadio(null), [])
  assert.deepEqual(recordingsFromRadio([]), [])
  assert.deepEqual(recordingsFromRadio({ x: 'nope' }), [])
})

test('recording names come from the metadata answer, with Cover Art Archive covers when it has one', () => {
  const songs = songsFromMetadata(recordingsFromRadio(radio), metadata)
  assert.deepEqual(songs, [
    {
      title: 'One More Time',
      artist: 'Daft Punk',
      artistMbid: DAFT_PUNK,
      album: 'Discovery',
      artwork: 'https://coverartarchive.org/release/fc312bd8-511a-4b49-9250-f60ad2fe0bcf/44358089765-250.jpg'
    },
    { title: 'Teardrop', artist: 'Massive Attack', artistMbid: MASSIVE_ATTACK, album: 'Mezzanine' },
    { title: 'Creep', artist: 'Radiohead', artistMbid: RADIOHEAD },
    { title: 'Around the World', artist: 'Daft Punk', artistMbid: DAFT_PUNK, album: 'Homework' }
  ])
  // Unnamed recordings and the same song twice are dropped.
  assert.deepEqual(
    songsFromMetadata(
      [
        { mbid: rec(5), artistMbid: RADIOHEAD },
        { mbid: rec(6), artistMbid: RADIOHEAD },
        { mbid: rec(7), artistMbid: RADIOHEAD }
      ],
      { [rec(5)]: meta('Creep', 'Radiohead'), [rec(6)]: { recording: {} }, [rec(7)]: meta('Creep', 'Radiohead') }
    ).length,
    1
  )
  assert.deepEqual(songsFromMetadata([{ mbid: rec(5), artistMbid: RADIOHEAD }], null), [])
})

test('picked songs skip known ones and the artist they are like, with at most two per artist', () => {
  const song = (title: string, artist: string, artistMbid = DAFT_PUNK): SimilarSong => ({ title, artist, artistMbid })
  const songs = [
    song('Creep', 'Radiohead', RADIOHEAD),
    song('One More Time', 'Daft Punk'),
    song('Digital Love', 'Daft Punk'),
    song('Harder, Better, Faster, Stronger', 'Daft Punk'),
    song('Teardrop', 'Massive Attack', MASSIVE_ATTACK),
    song('Angel', 'Massive Attack', MASSIVE_ATTACK)
  ]
  const picked = pickSongs(songs, { skip: new Set(['daft punk|digital love']), skipArtist: RADIOHEAD, limit: 3 })
  assert.deepEqual(
    picked.map(s => s.title),
    ['One More Time', 'Harder, Better, Faster, Stronger', 'Teardrop']
  )
  assert.equal(pickSongs(songs, { skip: new Set(), limit: 10 }).length, 5)
})

test('similar songs are asked for once per artist for a while; failures are not kept', async () => {
  let clock = 0
  const asked: string[] = []
  let down = false
  const similar = createSimilarSongs({
    now: () => clock,
    fetchBody: async url => {
      asked.push(url.pathname)
      if (down) throw new Error('timeout')
      if (url.pathname.includes('lb-radio')) {
        assert.match(url.search, /mode=easy/)
        return radio
      }
      assert.equal(url.searchParams.get('recording_mbids'), [rec(2), rec(4), rec(5), rec(3)].join(','))
      return metadata
    }
  })

  const [first, again] = await Promise.all([similar(RADIOHEAD), similar(RADIOHEAD)])
  assert.equal(first.length, 4)
  assert.equal(again, first)
  assert.equal((await similar(RADIOHEAD)).length, 4)
  assert.deepEqual(asked, ['/1/lb-radio/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711', '/1/metadata/recording/'])

  clock += 31 * 60_000
  down = true
  assert.deepEqual(await similar(RADIOHEAD), [])
  down = false
  assert.equal((await similar(RADIOHEAD)).length, 4)
  assert.equal(asked.length, 5)

  assert.deepEqual(await similar('../../etc'), [])
  assert.equal(asked.length, 5)
})
