// Rutor: a public Russian tracker, no account needed. Its music section's search page lists a magnet link right in
// each row, so a search is a single request (no topic pages to open).
// Template: off by default. Written from how the site is known to work and NOT tested against the live site: if it
// finds nothing, the row markup patterns in parseListing and the search path below are the first things to check.
// Rutor often sits behind a bot check; if the self-test reports one, pick another mirror.

import {
  cleanQuery,
  elements,
  getText,
  parseCount,
  parseRelease,
  parseSize,
  siteOrigin,
  stripTags
} from './lib/torrent-kit.ts'
import type { ProviderPlugin, TorrentResult } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['rutor.info', 'rutor.is', '6tor.net']
const SITE = 'Rutor'
/** Rutor's "Music" category in its search path. */
const MUSIC = 2
/** Sort order in the search path: 2 = most seeded first. */
const BY_SEEDERS = 2
/** Search in titles only (options "000"). */
const TITLES_ONLY = '000'

export interface Row {
  id: string
  title: string
  magnet: string
  size?: number
  seeders?: number
  leechers?: number
}

/** `/search/<page>/<category>/<options>/<sort>/<text>` */
export const searchPath = (query: string): string =>
  `/search/0/${MUSIC}/${TITLES_ONLY}/${BY_SEEDERS}/${encodeURIComponent(query)}`

/** Rows of a results table: `<tr class="gai">` / `<tr class="tum">` with a magnet link, the title link, size, S/L. */
export function parseListing(html: string): Row[] {
  const seen = new Set<string>()
  return elements(html, 'tr').flatMap(row => {
    const magnet = /href="(magnet:\?xt=urn:btih:[^"]+)"/i.exec(row)?.[1]
    const topic = /<a[^>]*href="\/torrent\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(row)
    if (!magnet || !topic || seen.has(topic[1])) return []
    seen.add(topic[1])
    // The size is the cell that reads like "312.12 MB"; a comments cell can sit before it, so count no columns.
    const size = elements(row, 'td')
      .map(cell => stripTags(cell))
      .find(text => /^[\d.,]+\s*[KMGT]i?B$/i.test(text))
    const count = (cls: string) =>
      parseCount(
        stripTags(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`, 'i').exec(row)?.[1] ?? '') || undefined
      )
    return [
      {
        id: topic[1],
        title: stripTags(topic[2]),
        magnet: magnet.replace(/&amp;/g, '&'),
        size: size ? parseSize(size) : undefined,
        seeders: count('green'),
        leechers: count('red')
      }
    ]
  })
}

function toResult(row: Row): TorrentResult {
  const release = parseRelease(row.title)
  return {
    ...release,
    link: row.magnet,
    size: row.size,
    seeders: row.seeders,
    leechers: row.leechers
  }
}

const plugin: ProviderPlugin = {
  async test({ options }) {
    const origin = siteOrigin(options, MIRRORS)
    if (parseListing(await getText(new URL(searchPath('flac'), origin), SITE)).length === 0) {
      throw new Error('Rutor answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, options }) {
    const q = cleanQuery(query)
    if (!q) return []
    const origin = siteOrigin(options, MIRRORS)
    return parseListing(await getText(new URL(searchPath(q), origin), SITE)).map(toResult)
  }
}

export default plugin
