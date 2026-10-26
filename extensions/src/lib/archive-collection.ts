import type { Extension, Options, TorrentResult } from '../sdk'

/** [extra search clause, sort] for an Explore category, e.g. ['subject:(jazz)', 'downloads desc'] */
export type Category = readonly [clause: string, sort: string]

export interface CollectionConfig {
  /** Lucene clause selecting the collection, e.g. 'collection:(netlabels)' */
  scope: string
  /** Keyed by the category ids declared in index.json */
  categories: Record<string, Category>
  /** Default 'mediatype:(audio)' */
  mediatype?: string
  /** Extra clause derived from the user's options, e.g. "soundboard only" */
  optionClause?: (options: Options) => string
  /** Tags derived from an item, e.g. ['SBD'] */
  tags?: (doc: ArchiveDoc) => string[]
}

export interface ArchiveDoc {
  identifier: string
  title?: string | string[]
  creator?: string | string[]
  year?: string | number
  item_size?: number
  licenseurl?: string | string[]
}

const ORIGIN = 'https://archive.org'
const EXCLUDED = '-access-restricted-item:(true) AND -collection:(librivoxaudio OR audio_bookspoetry OR podcasts)'
const FIELDS = ['identifier', 'title', 'creator', 'year', 'item_size', 'licenseurl']

const first = <T>(value: T | T[] | undefined): T | undefined => (Array.isArray(value) ? value[0] : value)

/** Letters and digits only, so user text can't inject search syntax. */
export function words(query: string): string[] {
  return query
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .slice(0, 8)
}

export function licenseTags(url: string): string[] {
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\//i.exec(url)
  if (cc) return [`CC ${cc[1].toUpperCase()}`]
  return /publicdomain/i.test(url) ? ['PD'] : []
}

export function toResult(doc: ArchiveDoc, tags: string[]): TorrentResult {
  let title = String(first(doc.title) ?? doc.identifier)
  let artist = first(doc.creator)
  // Many uploads are titled "Artist - Album" with no creator field.
  if (!artist && title.includes(' - ')) {
    const split = title.indexOf(' - ')
    ;[artist, title] = [title.slice(0, split), title.slice(split + 3)]
  }
  return {
    title,
    artist,
    year: doc.year ? String(doc.year) : undefined,
    size: doc.item_size,
    link: `${ORIGIN}/download/${doc.identifier}/${doc.identifier}_archive.torrent`,
    artwork: `${ORIGIN}/services/img/${doc.identifier}`,
    tags
  }
}

/** An extension over one Internet Archive collection: search, Explore categories and a self-test. */
export function archiveCollection(config: CollectionConfig): Extension {
  const mediatype = config.mediatype ?? 'mediatype:(audio)'

  async function find(clause: string, sort: string, options: Options): Promise<TorrentResult[]> {
    const extra = config.optionClause?.(options)
    const url = new URL('/advancedsearch.php', ORIGIN)
    url.searchParams.set(
      'q',
      `(${config.scope}) AND ${clause} AND ${mediatype} AND ${EXCLUDED}${extra ? ` AND ${extra}` : ''}`
    )
    for (const field of FIELDS) url.searchParams.append('fl[]', field)
    url.searchParams.append('sort[]', sort)
    url.searchParams.set('rows', '30')
    url.searchParams.set('output', 'json')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`archive.org answered ${res.status}`)
    const body = (await res.json()) as { response: { docs: ArchiveDoc[] } }
    return body.response.docs.map(doc =>
      toResult(doc, [...(config.tags?.(doc) ?? []), ...licenseTags(String(first(doc.licenseurl) ?? ''))])
    )
  }

  return {
    async test() {
      const url = new URL('/advancedsearch.php', ORIGIN)
      url.searchParams.set('q', config.scope)
      url.searchParams.append('fl[]', 'identifier')
      url.searchParams.set('rows', '1')
      url.searchParams.set('output', 'json')
      const res = await fetch(url)
      if (!res.ok) throw new Error(`archive.org answered ${res.status}`)
      const body = (await res.json()) as { response: { numFound: number } }
      if (!body.response.numFound) throw new Error('The collection looks empty')
      return true
    },

    async search({ query, options }) {
      const terms = words(query)
      if (terms.length === 0) return []
      return find(terms.map(t => `(title:(${t}) OR creator:(${t}))`).join(' AND '), 'downloads desc', options)
    },

    async browse({ category, options }) {
      const [clause, sort] = config.categories[category] ?? Object.values(config.categories)[0]
      return find(clause, sort, options)
    }
  }
}
