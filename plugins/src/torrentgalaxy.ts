// TorrentGalaxy: HTML scraping of the Music search listing (ported from the qBittorrent search engine). The listing
// has no magnet links, so the top rows' detail pages are fetched to find one.
// Template: off by default and not tested against the live site.

import {
  cleanQuery,
  detailMagnet,
  getText,
  mapLimit,
  parseCount,
  parseRelease,
  parseSize,
  stripTags
} from './lib/torrent-kit.ts'
import type { ProviderPlugin } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['torrentgalaxy.one']
const SITE = 'TorrentGalaxy'
const MAX_PAGES = 20
const RESOLVE = 10

export interface Row {
  path: string
  name: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
const ROW = /<div class="tgxtablerow txlight".+?<\/table> ?<\/div>/g
const FIELDS =
  /<b>(?<name>.+?)<\/b>.+?href="(?<path>.+?)".+?(?<size>[0-9,.]+ (?:TB|GB|MB|KB)).+?green".+?(?<seeds>[0-9.,]+).+?>(?<leech>[0-9.,]+)/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  return [...page.matchAll(ROW)].flatMap(([tr]) => {
    const g = FIELDS.exec(tr)?.groups
    if (!g) return []
    return [
      {
        path: g.path,
        name: stripTags(g.name),
        size: parseSize(g.size),
        seeders: parseCount(g.seeds),
        leechers: parseCount(g.leech)
      }
    ]
  })
}

async function listing(query: string, page: number): Promise<Row[]> {
  const url = `https://${MIRRORS[0]}/get-posts/keywords:${encodeURIComponent(query)}:category:Music/?page=${page}`
  return parseListing(await getText(url, SITE))
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music', 1)).length === 0) {
      throw new Error('TorrentGalaxy answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, page = 1 }) {
    const q = cleanQuery(query)
    if (!q) return []
    const rows = await listing(q, page)
    const results = await mapLimit(rows.slice(0, RESOLVE), 4, async row => {
      const link = detailMagnet(await getText(new URL(row.path, `https://${MIRRORS[0]}`), SITE), row.name)
      if (!link) return undefined
      return { ...parseRelease(row.name), link, size: row.size, seeders: row.seeders, leechers: row.leechers }
    })
    return { results, hasMore: rows.length > 0 && page < MAX_PAGES }
  }
}

export default plugin
