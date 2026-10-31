// Offline tests for the chart extensions' parsers, with trimmed copies of real API responses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { biggerArtwork, country, FEEDS, feedUrl, parseAppleMusic, parseITunes } from '../src/apple-music-charts.ts'
import { CATEGORIES, coverArt, parseRecordings, parseReleaseGroups } from '../src/listenbrainz-charts.ts'

const manifest = (id: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'index.json'), 'utf8')).find(
    (m: { id: string }) => m.id === id
  ) as { categories: Array<{ id: string }> }

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bb/45/62/bb4562a3/26UMGIM63616.rgb.jpg'

test('Apple Music: every category has a feed, and feeds point at the declared hosts', () => {
  assert.deepEqual(
    manifest('apple-music-charts').categories.map(c => c.id),
    Object.keys(FEEDS)
  )
  assert.equal(
    feedUrl(FEEDS['most-played-songs'], 'gb'),
    'https://rss.marketingtools.apple.com/api/v2/gb/music/most-played/50/songs.json'
  )
  assert.equal(feedUrl(FEEDS['top-albums'], 'us'), 'https://itunes.apple.com/us/rss/topalbums/limit=50/json')
  assert.equal(feedUrl(FEEDS.rock, 'in', 10), 'https://itunes.apple.com/in/rss/topalbums/limit=10/genre=21/json')
  assert.equal(country({ country: ' GB ' }), 'gb')
  assert.equal(country({ country: 'gb/../x' }), 'us')
  assert.equal(country({}), 'us')
})

test('Apple Music: most-played feed', () => {
  const body = {
    feed: {
      results: [
        {
          artistName: 'Drake',
          name: 'HABIBTI (FOMO)',
          releaseDate: '2026-10-02',
          artworkUrl100: `${ART}/100x100bb.jpg`,
          genres: [{ name: 'R&B/Soul' }, { name: 'Music' }]
        },
        { name: 'No artist' }
      ]
    }
  }
  assert.deepEqual(parseAppleMusic(body, 'album'), [
    {
      kind: 'album',
      title: 'HABIBTI (FOMO)',
      artist: 'Drake',
      year: '2026',
      artwork: `${ART}/400x400bb.jpg`,
      tags: ['R&B/Soul']
    }
  ])
  assert.deepEqual(parseAppleMusic({}, 'song'), [])
})

test('iTunes: top songs carry their album; a single entry is an object, not an array', () => {
  const entry = {
    'im:name': { label: 'Thriller' },
    'im:artist': { label: 'Michael Jackson' },
    'im:image': [{ label: `${ART}/55x55bb.png` }, { label: `${ART}/170x170bb.png` }],
    'im:releaseDate': { label: '1982-11-30T00:00:00-07:00' },
    'im:collection': { 'im:name': { label: 'Thriller' } },
    category: { attributes: { label: 'Pop' } }
  }
  const expected = {
    kind: 'song',
    title: 'Thriller',
    artist: 'Michael Jackson',
    album: 'Thriller',
    year: '1982',
    artwork: `${ART}/400x400bb.jpg`,
    tags: ['Pop']
  }
  assert.deepEqual(parseITunes({ feed: { entry: [entry, { 'im:name': { label: 'x' } }] } }, 'song'), [expected])
  assert.deepEqual(parseITunes({ feed: { entry } }, 'song'), [expected])
  assert.equal(parseITunes({ feed: { entry } }, 'album')[0].album, undefined)
  assert.deepEqual(parseITunes({ feed: {} }, 'album'), [])
})

test('biggerArtwork only rewrites https Apple-style sizes', () => {
  assert.equal(biggerArtwork(`${ART}/60x60bb.png`), `${ART}/400x400bb.jpg`)
  assert.equal(biggerArtwork('http://insecure.example/a.jpg'), undefined)
  assert.equal(biggerArtwork(undefined), undefined)
})

test('ListenBrainz: categories match the manifest; albums are deduplicated across editions', () => {
  assert.deepEqual(
    manifest('listenbrainz-charts').categories.map(c => c.id),
    Object.keys(CATEGORIES)
  )
  const group = {
    artist_name: 'BTS',
    caa_id: 44649468687,
    caa_release_mbid: '909d000d-56e9-4b38-aa3f-008d38436ea2',
    release_group_mbid: '21159e3f-172e-43f6-aa7d-8e06a81fea49',
    release_group_name: 'ARIRANG'
  }
  assert.deepEqual(parseReleaseGroups([group, { ...group, caa_id: 1 }, { release_group_name: 'No artist' }]), [
    {
      kind: 'album',
      title: 'ARIRANG',
      artist: 'BTS',
      artwork: 'https://coverartarchive.org/release/909d000d-56e9-4b38-aa3f-008d38436ea2/44649468687-250.jpg'
    }
  ])
})

test('ListenBrainz: songs carry their release; bad cover ids give no artwork', () => {
  const songs = parseRecordings([
    {
      artist_name: 'BTS',
      recording_mbid: '6f33dc05-cdc0-4a2f-8039-e8fed082eec6',
      track_name: 'SWIM',
      release_name: 'ARIRANG',
      caa_release_mbid: '../../evil',
      caa_id: 5
    },
    { artist_name: 'BTS', recording_mbid: '6f33dc05-cdc0-4a2f-8039-e8fed082eec6', track_name: 'SWIM' }
  ])
  assert.deepEqual(songs, [{ kind: 'song', title: 'SWIM', artist: 'BTS', album: 'ARIRANG', artwork: undefined }])
  assert.equal(coverArt({ caa_release_mbid: '909d000d-56e9-4b38-aa3f-008d38436ea2' }), undefined)
})
