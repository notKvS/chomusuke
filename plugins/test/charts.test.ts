// Offline tests for the chart plugins' parsers, with trimmed copies of real API responses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { biggerArtwork, country, FEEDS, feedUrl, parseAppleMusic, parseITunes } from '../src/apple-music-charts.ts'
import { CATEGORIES, coverArt, parseRecordings, parseReleaseGroups } from '../src/listenbrainz-charts.ts'
import {
  kworbUrl,
  oembedCover,
  oembedUrl,
  pageOf,
  parseKworb,
  parseSpotify,
  FEEDS as SPOTIFY_FEEDS,
  country as spotifyCountry
} from '../src/spotify-charts.ts'
import {
  cleanVideoTitle,
  parseChart,
  requestBody,
  CHARTS as YT_CHARTS,
  country as ytCountry
} from '../src/youtube-music-charts.ts'

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

// --- Spotify ---

test('Spotify: categories match the manifest; global charts from the official feed', () => {
  assert.deepEqual(
    manifest('spotify-charts').categories.map(c => c.id),
    Object.keys(SPOTIFY_FEEDS)
  )
  const body = {
    chartEntryViewResponses: [
      {
        displayChart: { chartMetadata: { alias: 'REGIONAL_GLOBAL_WEEKLY' } },
        entries: [
          {
            trackMetadata: {
              trackName: 'BbY WOW',
              displayImageUri: 'https://i.scdn.co/image/abc',
              artists: [{ name: 'KAROL G' }, { name: 'Judeline' }]
            }
          },
          { trackMetadata: { trackName: 'No artists', artists: [] } }
        ]
      },
      {
        displayChart: { chartMetadata: { alias: 'ALBUM_GLOBAL_WEEKLY' } },
        entries: [
          { albumMetadata: { albumName: 'ARIRANG', displayImageUri: 'http://insecure/x', artists: [{ name: 'BTS' }] } }
        ]
      }
    ]
  }
  assert.deepEqual(parseSpotify(body, 'REGIONAL_GLOBAL_WEEKLY'), [
    { kind: 'song', title: 'BbY WOW', artist: 'KAROL G, Judeline', artwork: 'https://i.scdn.co/image/abc' }
  ])
  assert.deepEqual(parseSpotify(body, 'ALBUM_GLOBAL_WEEKLY'), [
    { kind: 'album', title: 'ARIRANG', artist: 'BTS', artwork: undefined }
  ])
  assert.deepEqual(parseSpotify({}, 'REGIONAL_GLOBAL_WEEKLY'), [])
})

test('Spotify: kworb country charts, with guests, series names and entities handled; served 50 a page', () => {
  const row = (cell: string) =>
    `<tr><td class="np">1</td><td class="np">=</td><td class="text mp"><div>${cell}</div></td><td>14</td></tr>`
  const html = [
    row('<a href="../artist/1.html">Tate McRae</a> - <a href="../track/2sFepQNyl1WjpROruP8bJ0.html">Housewife</a>'),
    row(
      '<a href="../artist/2.html">KAROL G</a> - <a href="../track/2.html">BbY WOW</a> (w/ <a>Judeline</a>, <a>rusowsky</a>)'
    ),
    row('<a>Anuv Jain</a> - <a>Arz Kiya Hai | Coke Studio Bharat</a>'),
    row('<a>Simon &amp; Garfunkel</a> - <a>Mrs. Robinson</a>'),
    row('<a>No title here</a>')
  ].join('\n')
  assert.deepEqual(parseKworb(html), [
    { kind: 'song', title: 'Housewife', artist: 'Tate McRae', spotifyId: '2sFepQNyl1WjpROruP8bJ0' },
    { kind: 'song', title: 'BbY WOW', artist: 'KAROL G, Judeline, rusowsky' },
    { kind: 'song', title: 'Arz Kiya Hai', artist: 'Anuv Jain' },
    { kind: 'song', title: 'Mrs. Robinson', artist: 'Simon & Garfunkel' }
  ])
  const top200 = Array.from({ length: 200 }, (_, i) => ({ kind: 'song' as const, title: `#${i + 1}`, artist: 'A' }))
  const first = pageOf(top200, 1)
  const last = pageOf(top200, 4)
  assert.ok(!Array.isArray(first) && first.results.length === 50 && first.hasMore)
  assert.ok(!Array.isArray(last) && last.results[0].title === '#151' && !last.hasMore)
  assert.equal(kworbUrl('in', 'daily'), 'https://kworb.net/spotify/country/in_daily.html')
  assert.equal(spotifyCountry({ country: 'IN' }), 'in')
  assert.equal(spotifyCountry({ country: '' }), 'global')
  assert.equal(spotifyCountry({ country: '../x' }), 'global')
})

test('Spotify: kworb rows get their cover from oEmbed, served from i.scdn.co', () => {
  assert.equal(
    oembedUrl('2sFepQNyl1WjpROruP8bJ0'),
    'https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F2sFepQNyl1WjpROruP8bJ0'
  )
  assert.equal(
    oembedCover({
      thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02f6f1afd1aebea6906dd2a253'
    }),
    'https://i.scdn.co/image/ab67616d00001e02f6f1afd1aebea6906dd2a253'
  )
  assert.equal(oembedCover({ thumbnail_url: 'https://evil.example/x.jpg' }), undefined)
  assert.equal(oembedCover({}), undefined)
})

// --- YouTube Music ---

test('YouTube Music: categories match the manifest; songs and videos from the analytics response', () => {
  assert.deepEqual(
    manifest('youtube-music-charts').categories.map(c => c.id),
    Object.keys(YT_CHARTS)
  )
  const songs = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            musicAnalyticsSectionRenderer: {
              content: {
                trackTypes: [
                  {
                    trackViews: [
                      {
                        name: 'Dai Dai',
                        artists: [{ name: 'Shakira' }, { name: 'Burna Boy' }],
                        thumbnail: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/x=w180-h180-l90-rj' }] }
                      },
                      { name: 'No artist', artists: [] }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }
    }
  }
  assert.deepEqual(parseChart(songs, YT_CHARTS['top-songs']), [
    {
      kind: 'song',
      title: 'Dai Dai',
      artist: 'Shakira, Burna Boy',
      artwork: 'https://yt3.googleusercontent.com/x=w400-h400-l90-rj'
    }
  ])
  const videos = {
    content: {
      videos: [
        {
          videoViews: [
            { id: 'fcnDmrtj6Sk', title: 'Shakira - Dai Dai (Official Video)', artists: [{ name: 'Shakira' }] },
            { id: 'bad id!', title: 'Song', artists: [{ name: 'X' }] }
          ]
        }
      ]
    }
  }
  assert.deepEqual(parseChart(videos, YT_CHARTS['top-videos']), [
    { kind: 'song', title: 'Dai Dai', artist: 'Shakira', artwork: 'https://i.ytimg.com/vi/fcnDmrtj6Sk/hqdefault.jpg' },
    { kind: 'song', title: 'Song', artist: 'X', artwork: undefined }
  ])
  assert.deepEqual(parseChart({ error: { code: 400 } }, YT_CHARTS['top-songs']), [])
  const body = JSON.parse(requestBody('VIDEOS', 'in'))
  assert.match(body.query, /chart_params_country_code=in&chart_params_chart_type=VIDEOS/)
  assert.equal(ytCountry({ country: 'GB' }), 'gb')
  assert.equal(ytCountry({}), 'global')
})

test('YouTube Music: video titles lose "(Official Video)", lyric tags, "| extras" and an "Artist - " prefix', () => {
  assert.equal(cleanVideoTitle('Shakira - Dai Dai (Official Music Video)', 'Shakira, Burna Boy'), 'Dai Dai')
  assert.equal(cleanVideoTitle('Espresso [Lyric Video]', 'Sabrina Carpenter'), 'Espresso')
  assert.equal(
    cleanVideoTitle('Casa Tupka Anthem | Yo Yo Honey Singh | New Song 2026', 'Yo Yo Honey Singh'),
    'Casa Tupka Anthem'
  )
  // A dash that isn't the artist's name stays
  assert.equal(cleanVideoTitle('Love Me - Remix', 'Someone'), 'Love Me - Remix')
  assert.equal(cleanVideoTitle('(Official Video)', 'X'), '(Official Video)')
})
