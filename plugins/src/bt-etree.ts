// bt.etree: HTML scraping of the live-concert recordings tracker (ported from the qBittorrent search engine).
// Each result row carries its .torrent download link, so a search is a single request.
// Template: off by default and not tested against the live site.

import {
  cleanQuery,
  decodeEntities,
  getText,
  parseCount,
  parseRelease,
  parseSize,
  stripTags
} from './lib/torrent-kit.ts'
import type { ProviderPlugin } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['bt.etree.org']
const SITE = 'bt.etree'
const MAX_PAGES = 20
/** The site pages by row offset, 50 rows at a time. */
const PAGE_SIZE = 50

export interface Row {
  name: string
  /** The .torrent href exactly as the page has it (relative to the site root, not yet encoded). */
  download: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
const ROW = /<tr align="right" bgcolor="#ffffff">.+?<\/tr>/g
const FIELDS =
  /<tr.+?details_link.+?href=".+?".+?<b>(.+?)<\/b>.+?href="(.+?)".+?([0-9,.]+ (?:TB|GB|MB|KB)).+?seeders">([0-9,]+).+?leechers">([0-9,]+)/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(ROW)].flatMap(([tr]) => {
    const fields = FIELDS.exec(tr)
    if (!fields) return []
    return [
      {
        name: stripTags(fields[1]),
        download: fields[2],
        size: parseSize(fields[3]),
        seeders: parseCount(fields[4]),
        leechers: parseCount(fields[5])
      }
    ]
  })
}

/** The app's pages are 1-based; the site's `page` is the offset of the first row. */
async function listing(query: string, page: number): Promise<Row[]> {
  const q = encodeURIComponent(query)
  return parseListing(
    await getText(`https://${MIRRORS[0]}/index.php?searchzzzz=${q}&cat=0&page=${PAGE_SIZE * (page - 1)}`, SITE)
  )
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('bt.etree answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, page = 1 }) {
    const q = cleanQuery(query)
    if (!q) return []
    const rows = await listing(q, page)
    return {
      results: rows.map(row => ({
        ...parseRelease(row.name),
        link: `https://${MIRRORS[0]}/${decodeEntities(row.download).split('/').map(encodeURIComponent).join('/')}`,
        size: row.size,
        seeders: row.seeders,
        leechers: row.leechers
      })),
      hasMore: rows.length > 0 && page < MAX_PAGES
    }
  }
}

export default plugin
