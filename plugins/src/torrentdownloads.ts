// TorrentDownloads: HTML scraping of the Music search listing (ported from the qBittorrent search engine). The
// listing has no magnet links, so the top rows' detail pages are fetched to find one.
// Template: off by default and not tested against the live site.

import {
  cleanQuery,
  decodeEntities,
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
export const MIRRORS = ['www.torrentdownloads.pro']
const SITE = 'TorrentDownloads'
const RESOLVE = 10

export interface Row {
  path: string
  name: string
  size?: number
  seeders?: number
  leechers?: number
}

// Both patterns run on whitespace-collapsed HTML (one line), as in the upstream engine.
const ROW = /<div class="grey_bar3(?: back_none)?".+?check_box.+?<\/div>/g
// The upstream leecher group is `([0-9,.])`, which keeps a single digit; it takes the whole number here.
const FIELDS =
  /href="(?<path>.+?)".+?>\s?(?<name>.+?)<\/a>.+?<span>(?<seeds>[0-9,.]+).+?span>(?<leech>[0-9,.]+).+?(?<size>[0-9,.]+ (?:TB|GB|MB|KB))/

export function parseListing(html: string): Row[] {
  const page = html.replace(/\s+/g, ' ').trim()
  // The first match is the table header.
  return [...page.matchAll(ROW)].slice(1).flatMap(([tr]) => {
    const g = FIELDS.exec(tr)?.groups
    if (!g) return []
    return [
      {
        path: decodeEntities(g.path),
        name: stripTags(g.name),
        size: parseSize(g.size),
        seeders: parseCount(g.seeds),
        leechers: parseCount(g.leech)
      }
    ]
  })
}

async function listing(query: string): Promise<Row[]> {
  const url = `https://${MIRRORS[0]}/search/?page=1&search=${encodeURIComponent(query)}&s_cat=5&srt=seeds&pp=50&order=desc`
  return parseListing(await getText(url, SITE))
}

const plugin: ProviderPlugin = {
  async test() {
    if ((await listing('music')).length === 0) {
      throw new Error('TorrentDownloads answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  // Each call resolves only the top rows' detail pages, so it always reads site page 1: paging would skip rows.
  async search({ query }) {
    const q = cleanQuery(query)
    if (!q) return []
    const rows = await listing(q)
    return mapLimit(rows.slice(0, RESOLVE), 4, async row => {
      const link = detailMagnet(await getText(new URL(row.path, `https://${MIRRORS[0]}`), SITE), row.name)
      if (!link) return undefined
      return { ...parseRelease(row.name), link, size: row.size, seeders: row.seeders, leechers: row.leechers }
    })
  }
}

export default plugin
