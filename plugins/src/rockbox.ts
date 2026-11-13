// RockBox: HTML scraping of the music tracker (ported from the qBittorrent search engine).
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
export const MIRRORS = ['rawkbawx.rocks']
const SITE = 'RockBox'
const MAX_PAGES = 20

export interface Row {
  name: string
  /** The .torrent href, relative to the site root, with HTML entities decoded. */
  download: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
// The patterns are case-sensitive (<TR>, HREF), and the download href is unquoted.
const ROW = /<TR> <td align="center".*?<\/TR>/g
const FIELDS =
  /HREF="(details.+?)".+?details:\s?(.+?)">.+?HREF=(download[^\s>]+).+?lista">(.+?)<\/td>.+?([0-9,.]+ (?:TB|GB|MB|KB)).+?peers details">([0-9,]+).+?peers details">([0-9,]+)/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(ROW)].flatMap(([tr]) => {
    const fields = FIELDS.exec(tr)
    if (!fields) return []
    // fields[4] is the upload date; the result type has no date field, so it is not used.
    return [
      {
        name: stripTags(fields[2]),
        download: decodeEntities(fields[3]),
        size: parseSize(fields[5]),
        seeders: parseCount(fields[6]),
        leechers: parseCount(fields[7])
      }
    ]
  })
}

/** The app's pages are 1-based; the site's `page` is 0-based. */
async function listing(query: string, page: number): Promise<Row[]> {
  const q = encodeURIComponent(query)
  return parseListing(
    await getText(`https://${MIRRORS[0]}/torrents.php?active=0&search=${q}&options=0&order=data&page=${page - 1}`, SITE)
  )
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('RockBox answered, but the page had no torrents — the site layout may have changed.')
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
        link: `https://${MIRRORS[0]}/${row.download}`,
        size: row.size,
        seeders: row.seeders,
        leechers: row.leechers
      })),
      hasMore: rows.length > 0 && page < MAX_PAGES
    }
  }
}

export default plugin
