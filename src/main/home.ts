import type { ExploreSource, HomeShelf } from '../shared/types.ts'

/** The Home shelves for what you listen to; see {@link planHome}. */

/** Artists that get their own "More from …" shelf. */
export const ARTIST_SHELVES = 2

/** Which of the chart's genre categories (by id) a MusicBrainz tag belongs to; the first match wins. */
const GENRES: Array<[category: string, tag: RegExp]> = [
  ['k-pop', /k-?pop|korean/],
  ['hip-hop', /hip.?hop|\brap\b|trap/],
  ['rnb', /r&b|\brnb\b|\bsoul\b|rhythm and blues/],
  ['electronic', /electro|\bedm\b|house|techno|trance|dance|dubstep/],
  ['latin', /latin|reggaeton|salsa|bachata|cumbia/],
  ['country', /country|bluegrass/],
  ['jazz', /jazz|swing|bebop/],
  ['classical', /classical|orchestra|baroque|opera/],
  ['soundtrack', /soundtrack|film score|video game/],
  ['alternative', /alternative|indie|grunge|shoegaze|post-punk|emo/],
  ['rock', /rock|metal|punk|hard core/],
  ['pop', /\bpop\b|singer-songwriter/]
]

/** The genre category for an artist's tags (most agreed-on first), if the chart has one for it. */
export function genreCategory(tags: string[], available: ReadonlySet<string>): string | undefined {
  for (const tag of tags) {
    const match = GENRES.find(([, pattern]) => pattern.test(tag))
    if (match && available.has(match[0])) return match[0]
  }
  return undefined
}

/**
 * What Home shows besides the albums you opened: more from the artists you play most, and a chart in their genre.
 * With no history it's a popular chart picked at random, so Home is never empty while a chart is on.
 * `genres[i]` are the tags of `artists[i]`.
 */
export function planHome(input: {
  artists: string[]
  genres: string[][]
  charts: ExploreSource[]
  random: () => number
}): HomeShelf[] {
  const { artists, genres, charts, random } = input
  if (artists.length === 0) {
    if (charts.length === 0) return []
    const chart = charts[Math.floor(random() * charts.length) % charts.length]
    // Songs read better than genre albums: prefer a category that says so.
    const category = chart.categories.find(c => /song|played/i.test(c.name)) ?? chart.categories[0]
    if (!category) return []
    return [
      {
        id: 'popular',
        title: `Popular on ${chart.name}`,
        subtitle: category.name,
        source: { kind: 'chart', sourceId: chart.id, categoryId: category.id }
      }
    ]
  }

  const shelves: HomeShelf[] = artists.slice(0, ARTIST_SHELVES).map(artist => ({
    id: `artist:${artist.toLowerCase()}`,
    title: `More from ${artist}`,
    subtitle: 'Because you listen to them',
    source: { kind: 'search', query: artist }
  }))

  const byCategory = new Map(
    charts.flatMap(chart => chart.categories.map(c => [c.id, { chart, category: c }] as const))
  )
  for (const [index, artist] of artists.entries()) {
    const id = genreCategory(genres[index] ?? [], new Set(byCategory.keys()))
    const found = id && byCategory.get(id)
    if (found) {
      shelves.push({
        id: `genre:${id}`,
        title: `More ${found.category.name}`,
        subtitle: `Like ${artist}`,
        source: { kind: 'chart', sourceId: found.chart.id, categoryId: found.category.id }
      })
      break
    }
  }
  return shelves
}
