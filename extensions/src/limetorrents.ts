// LimeTorrents: HTML scraping of the Music category. Result rows usually carry the info hash (in their
// itorrents .torrent link); rows without one fall back to the detail page's magnet link.
// Template: off by default and not tested against the live site.
import type { Extension, TorrentResult } from './sdk.ts'
import { cleanQuery, elements, getText, magnet, mapLimit, parseCount, parseRelease, parseSize, siteOrigin, stripTags } from './lib/torrent-kit.ts'

/** Must match "hosts" in index.json. LimeTorrents changes domain often; add the new one in both places. */
export const MIRRORS = ['www.limetorrents.fun', 'www.limetorrents.lol', 'limetorrents.torrentbay.st', 'limetorrents.torrentsbay.org']
const SITE = 'LimeTorrents'
const RESOLVE = 10

const BROWSE: Record<string, string> = {
  'top-seeded': '/browse-torrents/Music/seeds/1/',
  latest: '/browse-torrents/Music/date/1/'
}

export interface Row {
  path: string
  name: string
  hash?: string
  seeders?: number
  leechers?: number
  size?: number
}

export function parseListing(html: string): Row[] {
  const table = /<table[^>]*class="[^"]*\btable2\b[^"]*"[\s\S]*?<\/table>/i.exec(html)?.[0] ?? ''
  return elements(table, 'tr').flatMap(row => {
    const link = /<div class="tt-name">[\s\S]*?<a href="(\/[^"]+-torrent-\d+\.html)"[^>]*>([\s\S]*?)<\/a>/i.exec(row)
    if (!link) return []
    const cells = elements(row, 'td').map(stripTags)
    return [
      {
        path: link[1],
        name: stripTags(link[2]),
        hash: /\/torrent\/([a-f0-9]{40})\.torrent/i.exec(row)?.[1],
        size: cells[2] ? parseSize(cells[2]) : undefined,
        seeders: parseCount(stripTags(/class="tdseed"[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1] ?? '')),
        leechers: parseCount(stripTags(/class="tdleech"[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1] ?? ''))
      }
    ]
  })
}

export function parseMagnet(html: string): string | undefined {
  return /href="(magnet:\?xt=urn:btih:[^"]+)"/i.exec(html)?.[1]?.replace(/&amp;/g, '&')
}

async function toResults(origin: string, rows: Row[]): Promise<TorrentResult[]> {
  // Rows with a hash need no extra request; only the first few without one are looked up.
  let lookups = 0
  const wanted = rows.filter(row => row.hash || lookups++ < RESOLVE)
  return mapLimit(wanted, 4, async row => {
    const link = row.hash ? magnet(row.hash, row.name) : parseMagnet(await getText(new URL(row.path, origin), SITE))
    if (!link) return undefined
    return { ...parseRelease(row.name), link, size: row.size, seeders: row.seeders, leechers: row.leechers }
  })
}

async function listing(origin: string, path: string): Promise<TorrentResult[]> {
  return toResults(origin, parseListing(await getText(new URL(path, origin), SITE)))
}

const extension: Extension = {
  async test({ options }) {
    const origin = siteOrigin(options, MIRRORS)
    if (parseListing(await getText(new URL(BROWSE.latest, origin), SITE)).length === 0) {
      throw new Error('LimeTorrents answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, options }) {
    const q = cleanQuery(query)
    if (!q) return []
    return listing(siteOrigin(options, MIRRORS), `/search/music/${encodeURIComponent(q)}/seeds/1/`)
  },

  async browse({ category, options }) {
    return listing(siteOrigin(options, MIRRORS), BROWSE[category] ?? BROWSE['top-seeded'])
  }
}

export default extension
