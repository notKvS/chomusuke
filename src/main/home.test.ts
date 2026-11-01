import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExploreSource } from '../shared/types.ts'
import { genresFromSearch } from './genres.ts'
import { genreCategory, planHome } from './home.ts'

const apple: ExploreSource = {
  id: 'plugin-apple',
  name: 'Apple Music charts',
  categories: [
    { id: 'most-played-songs', name: 'Most played songs' },
    { id: 'pop', name: 'Pop' },
    { id: 'rock', name: 'Rock' },
    { id: 'alternative', name: 'Alternative' },
    { id: 'k-pop', name: 'K-Pop' }
  ]
}
const spotify: ExploreSource = {
  id: 'plugin-spotify',
  name: 'Spotify charts',
  categories: [{ id: 'global-songs', name: 'Top songs (global, weekly)' }]
}
const have = new Set(apple.categories.map(c => c.id))

test('artist tags lead to a genre the charts have', () => {
  assert.equal(genreCategory(['alternative rock', 'pop', 'british'], have), 'alternative')
  assert.equal(genreCategory(['british', 'pop rock'], have), 'rock')
  assert.equal(genreCategory(['k-pop', 'pop'], have), 'k-pop')
  assert.equal(genreCategory(['british', 'uk'], have), undefined)
  // A genre the charts don't list is skipped for the next tag.
  assert.equal(genreCategory(['jazz', 'pop'], have), 'pop')
  assert.equal(genreCategory([], have), undefined)
})

test('Home gets shelves for the top artists and one for their genre', () => {
  const shelves = planHome({
    artists: ['Coldplay', 'Anuv Jain', 'Third'],
    genres: [['alternative rock', 'pop'], ['indie']],
    charts: [spotify, apple],
    random: () => 0
  })
  assert.deepEqual(
    shelves.map(s => [s.id, s.title, s.source]),
    [
      ['artist:coldplay', 'More from Coldplay', { kind: 'search', query: 'Coldplay' }],
      ['artist:anuv jain', 'More from Anuv Jain', { kind: 'search', query: 'Anuv Jain' }],
      ['genre:alternative', 'More Alternative', { kind: 'chart', sourceId: 'plugin-apple', categoryId: 'alternative' }]
    ]
  )
  assert.equal(shelves[2].subtitle, 'Like Coldplay')
})

test('the genre shelf is skipped when no artist maps to a chart genre, or no chart is on', () => {
  const noGenre = planHome({ artists: ['A'], genres: [['british']], charts: [apple], random: () => 0 })
  assert.deepEqual(
    noGenre.map(s => s.id),
    ['artist:a']
  )
  const noCharts = planHome({ artists: ['A'], genres: [['pop']], charts: [], random: () => 0 })
  assert.deepEqual(
    noCharts.map(s => s.id),
    ['artist:a']
  )
  // Genres that couldn't be looked up in time.
  const noTags = planHome({ artists: ['A', 'B'], genres: [], charts: [apple], random: () => 0 })
  assert.deepEqual(
    noTags.map(s => s.id),
    ['artist:a', 'artist:b']
  )
})

test('with nothing played, Home shows a popular chart picked at random', () => {
  const first = planHome({ artists: [], genres: [], charts: [spotify, apple], random: () => 0 })
  assert.deepEqual(first, [
    {
      id: 'popular',
      title: 'Popular on Spotify charts',
      subtitle: 'Top songs (global, weekly)',
      source: { kind: 'chart', sourceId: 'plugin-spotify', categoryId: 'global-songs' }
    }
  ])
  const second = planHome({ artists: [], genres: [], charts: [spotify, apple], random: () => 0.99 })
  assert.equal(second[0].title, 'Popular on Apple Music charts')
  assert.equal(second[0].subtitle, 'Most played songs')
  assert.deepEqual(planHome({ artists: [], genres: [], charts: [], random: () => 0 }), [])
})

test('MusicBrainz answers are used only for the artist asked about, most agreed tags first', () => {
  const body = {
    artists: [
      { name: 'Coldplay Tribute', score: 95, tags: [{ name: 'karaoke', count: 9 }] },
      {
        name: 'Coldplay',
        score: 100,
        tags: [
          { name: 'British', count: 10 },
          { name: 'Alternative Rock', count: 36 },
          { name: 'zero', count: 0 }
        ]
      }
    ]
  }
  assert.deepEqual(genresFromSearch('coldplay', body), ['alternative rock', 'british'])
  assert.deepEqual(genresFromSearch('Someone Else', body), [])
  const unsure = { artists: [{ name: 'Coldplay', score: 50, tags: [{ name: 'x', count: 1 }] }] }
  assert.deepEqual(genresFromSearch('Coldplay', unsure), [])
  assert.deepEqual(genresFromSearch('Coldplay', null), [])
  assert.deepEqual(genresFromSearch('Coldplay', { artists: [{ name: 'Coldplay', score: 100 }] }), [])
})

test('artist lookups are one a second, remembered, and not repeated for a while after a failure', async () => {
  const { createArtistGenres } = await import('./genres.ts')
  let clock = 1_000_000
  const waits: number[] = []
  const asked: string[] = []
  let down = false
  const genres = createArtistGenres({
    now: () => clock,
    sleep: async ms => {
      waits.push(ms)
      clock += ms
    },
    fetchBody: async url => {
      asked.push(new URL(url).searchParams.get('query') ?? '')
      if (down) throw new Error('timeout')
      return { artists: [{ name: 'Coldplay', score: 100, tags: [{ name: 'pop', count: 3 }] }] }
    }
  })

  const [first, second] = await Promise.all([genres('Coldplay'), genres('Coldplay ')])
  assert.deepEqual(first, ['pop'])
  assert.deepEqual(second, ['pop'])
  assert.deepEqual(await genres('COLDPLAY'), ['pop'])
  // Asked for twice at once, and again later: one request.
  assert.equal(asked.length, 1)

  down = true
  const before = asked.length
  assert.deepEqual(await genres('Broken Artist'), [])
  assert.deepEqual(await genres('Broken Artist'), [])
  assert.equal(asked.length, before + 1)
  clock += 6 * 60_000
  assert.deepEqual(await genres('Broken Artist'), [])
  assert.equal(asked.length, before + 2)
  assert.ok(waits.every(ms => ms > 0 && ms <= 1100))
  assert.deepEqual(await genres(''), [])
})
