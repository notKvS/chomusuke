// Example Chomusuke extension (see src/main/extensions/manifest.ts for the format).
// Runs in a sandboxed module worker: plain fetch() to the hosts declared in index.json, no DOM, no Node.

const ORIGIN = 'https://archive.org'
const BASE = 'collection:(etree) AND mediatype:(etree OR audio) AND -access-restricted-item:(true)'
const SORTS = { week: 'week desc', recent: 'addeddate desc', 'all-time': 'downloads desc' }

const words = query =>
  query
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .slice(0, 8)

async function find(clause, sort, options) {
  const filter = options.soundboardOnly ? ' AND (title:(sbd) OR identifier:(sbd) OR source:(soundboard))' : ''
  const url = new URL('/advancedsearch.php', ORIGIN)
  url.searchParams.set('q', `${clause} AND ${BASE}${filter}`)
  for (const field of ['identifier', 'title', 'creator', 'year', 'item_size', 'downloads']) url.searchParams.append('fl[]', field)
  url.searchParams.append('sort[]', sort)
  url.searchParams.set('rows', '30')
  url.searchParams.set('output', 'json')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`archive.org answered ${res.status}`)
  const { response } = await res.json()
  return response.docs.map(doc => ({
    title: String(doc.title ?? doc.identifier),
    artist: Array.isArray(doc.creator) ? doc.creator[0] : doc.creator,
    year: doc.year ? String(doc.year) : undefined,
    size: doc.item_size,
    link: `${ORIGIN}/download/${doc.identifier}/${doc.identifier}_archive.torrent`,
    artwork: `${ORIGIN}/services/img/${doc.identifier}`,
    tags: /sbd|soundboard/i.test(`${doc.identifier} ${doc.title}`) ? ['SBD'] : ['AUD']
  }))
}

export default {
  async test() {
    const res = await fetch(`${ORIGIN}/advancedsearch.php?q=collection:etree&fl[]=identifier&rows=1&output=json`)
    if (!res.ok) throw new Error(`archive.org answered ${res.status}`)
    return true
  },

  search({ query, options }) {
    const terms = words(query)
    if (terms.length === 0) return []
    return find(terms.map(t => `(title:(${t}) OR creator:(${t}))`).join(' AND '), 'downloads desc', options)
  },

  browse({ category, options }) {
    return find('*:*', SORTS[category] ?? SORTS.week, options)
  }
}
