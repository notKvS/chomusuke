// Nyaa: the big anime tracker; its Audio section is the place for anime OSTs, J-pop/J-rock and doujin music.
// Uses the site's RSS feed (search and listings), which carries seeders, size and the info hash per item.
// Template: off by default and not tested against the live site.
import type { Extension, Options, TorrentResult } from './sdk.ts'
import { cleanQuery, elements, getText, parseCount, parseRelease, parseSize, xmlText } from './lib/torrent-kit.ts'

const ORIGIN = 'https://nyaa.si'
const SITE = 'Nyaa'

// Audio categories: 2_0 all audio, 2_1 lossless, 2_2 lossy.
const CATEGORY_TAGS: Record<string, string> = { '2_1': 'Lossless', '2_2': 'Lossy' }

/** Explore category → [category, sort]. Sort is seeders or id (newest). */
const BROWSE: Record<string, [string, string]> = {
  'lossless-top': ['2_1', 'seeders'],
  'lossy-top': ['2_2', 'seeders'],
  latest: ['2_0', 'id']
}

/** Nyaa's filter: 0 none, 1 no remakes, 2 trusted uploaders only. */
const filter = (options: Options) => (options.trustedOnly === true ? '2' : '0')

export function parseFeed(xml: string): TorrentResult[] {
  return elements(xml, 'item').flatMap(item => {
    const name = xmlText(item, 'title')
    const link = xmlText(item, 'link')
    const hash = xmlText(item, 'nyaa:infoHash')
    if (!name || (!hash && !link)) return []
    let download: string | undefined
    try {
      // The .torrent download: same site, https only.
      const url = link ? new URL(link, ORIGIN) : undefined
      if (url && url.hostname === 'nyaa.si' && url.pathname.endsWith('.torrent')) download = `https://nyaa.si${url.pathname}`
    } catch {
      // ignore
    }
    const release = parseRelease(name)
    const category = CATEGORY_TAGS[xmlText(item, 'nyaa:categoryId') ?? '']
    const trusted = xmlText(item, 'nyaa:trusted') === 'Yes'
    return [
      {
        ...release,
        link: download,
        hash,
        size: parseSize(xmlText(item, 'nyaa:size') ?? ''),
        seeders: parseCount(xmlText(item, 'nyaa:seeders')),
        leechers: parseCount(xmlText(item, 'nyaa:leechers')),
        tags: [...new Set([...(category ? [category] : []), ...(release.tags ?? []), ...(trusted ? ['Trusted'] : [])])].slice(0, 4)
      }
    ]
  })
}

function feedUrl(params: { q?: string; c: string; s: string; options: Options }): URL {
  const url = new URL('/', ORIGIN)
  url.searchParams.set('page', 'rss')
  if (params.q) url.searchParams.set('q', params.q)
  url.searchParams.set('c', params.c)
  url.searchParams.set('f', filter(params.options))
  url.searchParams.set('s', params.s)
  url.searchParams.set('o', 'desc')
  return url
}

const extension: Extension = {
  async test({ options }) {
    const xml = await getText(feedUrl({ c: '2_0', s: 'id', options }), SITE)
    if (!/<rss\b/i.test(xml)) throw new Error('Nyaa answered, but not with its RSS feed — the site may have changed.')
    return true
  },

  async search({ query, options }) {
    const q = cleanQuery(query)
    if (!q) return []
    const category = options.losslessOnly === true ? '2_1' : '2_0'
    return parseFeed(await getText(feedUrl({ q, c: category, s: 'seeders', options }), SITE)).slice(0, 75)
  },

  async browse({ category, options }) {
    const [c, s] = BROWSE[category] ?? BROWSE['lossless-top']
    return parseFeed(await getText(feedUrl({ c, s, options }), SITE)).slice(0, 75)
  }
}

export default extension
