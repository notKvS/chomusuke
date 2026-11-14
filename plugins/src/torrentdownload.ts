// TorrentDownload: HTML scraping of the search listing (ported from the qBittorrent search engine). The site has no
// music filter, so rows are kept by their category label; the magnet is built from the info hash in each row's link.
// Template: off by default and not tested against the live site.

import { cleanQuery, getText, magnet, parseCount, parseRelease, parseSize, stripTags } from './lib/torrent-kit.ts'
import type { ProviderPlugin } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['www.torrentdownload.info']
const SITE = 'TorrentDownload'
const MAX_PAGES = 20
const MUSIC = /music|audio|lossless/i

export interface Row {
  name: string
  hash: string
  category?: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine. Cells are matched
// individually so that an unexpected value in one of them cannot silently discard the whole row.
const ROW = /<tr><td.+?tt-name.+?<\/tr>/g
const FIELDS = new RegExp(
  '(?:href="/(?<hash>[0-9A-Fa-f]{40})/(?<slug>[^"]*)">(?<name>.*?)</a>)' +
    '(?:\\s*<span class="smallish">\\s*(?:&raquo;|»)\\s*(?<cat>[^<]*)</span>)?' +
    '.*?<td class="tdnormal">[^<]*</td>' +
    '\\s*<td class="tdnormal">(?<size>[^<]*)</td>' +
    '\\s*<td class="tdseed">(?<seeds>[^<]*)</td>' +
    '\\s*<td class="tdleech">(?<leech>[^<]*)</td>'
)

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(ROW)].flatMap(([tr]) => {
    const g = FIELDS.exec(tr)?.groups
    if (!g) return []
    return [
      {
        name: stripTags(g.name),
        hash: g.hash,
        category: g.cat ? stripTags(g.cat) : undefined,
        size: parseSize(g.size),
        seeders: parseCount(g.seeds),
        leechers: parseCount(g.leech)
      }
    ]
  })
}

async function listing(query: string, page: number): Promise<Row[]> {
  return parseListing(await getText(`https://${MIRRORS[0]}/search?q=${encodeURIComponent(query)}&p=${page}`, SITE))
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('TorrentDownload answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, page = 1 }) {
    const q = cleanQuery(query)
    if (!q) return []
    const rows = await listing(q, page)
    return {
      results: rows
        .filter(row => row.category && MUSIC.test(row.category))
        .map(row => ({
          ...parseRelease(row.name),
          link: magnet(row.hash, row.name),
          size: row.size,
          seeders: row.seeders,
          leechers: row.leechers
        })),
      hasMore: rows.length > 0 && page < MAX_PAGES
    }
  }
}

export default plugin
