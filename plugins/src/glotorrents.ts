// GloTorrents: HTML scraping of the Music category (ported from the qBittorrent search engine). Each result row
// carries its magnet link, so a search is a single request.
// Template: off by default and not tested against the live site.

import { cleanQuery, getText, parseCount, parseRelease, parseSize, stripTags } from './lib/torrent-kit.ts'
import type { ProviderPlugin } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['glodls.to']
const SITE = 'GloTorrents'
const MAX_PAGES = 20

export interface Row {
  name: string
  magnet: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
const ROW = /<tr class='t-row'> <td class='ttable_col1'.+?<\/tr>/g
const FIELDS =
  /title="(.+?)".+?href="(.+?)".+?<\/a>.+?align='center'>.+?href="(magnet:.*?)".+?([0-9,.]+ (?:TB|GB|MB|KB)).+?<font color='green'><b>([0-9,]+)<\/b>.+?<font color='#[0-9a-zA-Z]{6}'><b>([0-9,]+)<\/b>/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(ROW)].flatMap(([tr]) => {
    const fields = FIELDS.exec(tr)
    if (!fields) return []
    return [
      {
        name: stripTags(fields[1]),
        magnet: fields[3].replace(/&amp;/g, '&'),
        size: parseSize(fields[4]),
        seeders: parseCount(fields[5]),
        leechers: parseCount(fields[6])
      }
    ]
  })
}

/** The site's pages are 0-based; the app's are 1-based. */
async function listing(query: string, page: number): Promise<Row[]> {
  const q = encodeURIComponent(query)
  return parseListing(
    await getText(
      `https://${MIRRORS[0]}/search_results.php?search=${q}&cat=22&page=${page - 1}&incldead=0&inclexternal=0`,
      SITE
    )
  )
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('GloTorrents answered, but the page had no torrents — the site layout may have changed.')
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
        link: row.magnet,
        size: row.size,
        seeders: row.seeders,
        leechers: row.leechers
      })),
      hasMore: rows.length > 0 && page < MAX_PAGES
    }
  }
}

export default plugin
