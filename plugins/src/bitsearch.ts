// BitSearch: HTML scraping of the Music category (ported from the qBittorrent search engine). Each result card
// carries its magnet link, so a search is a single request.
// Template: off by default and not tested against the live site.

import { cleanQuery, getText, parseCount, parseRelease, parseSize, stripTags } from './lib/torrent-kit.ts'
import type { ProviderPlugin } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['bitsearch.to']
const SITE = 'BitSearch'
const MAX_PAGES = 20

export interface Row {
  name: string
  magnet: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
const CARD =
  /<div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition duration-150 ease-in-out">.+?<\/div> ?<!-- Mobile/g
const FIELDS =
  /.+?href="(.+?)".+?"> ?(.+?) <\/a>.+?([0-9,.]+ (?:TB|GB|MB|KB)).+?i> <span>(.+?)<\/span>.+?medium">([0-9,.]+).+?medium">([0-9,.]+).+?href="(magnet.+?)"/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(CARD)].flatMap(([card]) => {
    const fields = FIELDS.exec(card)
    if (!fields) return []
    return [
      {
        name: stripTags(fields[2]),
        magnet: fields[7].replace(/&amp;/g, '&'),
        size: parseSize(fields[3]),
        seeders: parseCount(fields[5]),
        leechers: parseCount(fields[6])
      }
    ]
  })
}

async function listing(query: string, page: number): Promise<Row[]> {
  const q = encodeURIComponent(query)
  return parseListing(
    await getText(`https://${MIRRORS[0]}/search?q=${q}&page=${page}&category=7&sortBy=relevance`, SITE)
  )
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('BitSearch answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, page = 1 }) {
    const q = cleanQuery(query)
    if (!q) return []
    const rows = await listing(q, page)
    return {
      results: rows.map(row => {
        const release = parseRelease(row.name)
        return {
          ...release,
          link: row.magnet,
          size: row.size,
          seeders: row.seeders,
          leechers: row.leechers,
          tags: release.tags
        }
      }),
      hasMore: rows.length > 0 && page < MAX_PAGES
    }
  }
}

export default plugin
