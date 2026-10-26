// The Pirate Bay through apibay.org, the JSON API its own web front end uses.
// Template: off by default and not tested against the live site.
import type { Extension, Options, TorrentResult } from './sdk.ts'
import { cleanQuery, getJson, magnet, parseRelease } from './lib/torrent-kit.ts'

const API = 'https://apibay.org'
const SITE = 'The Pirate Bay'

// TPB audio categories: 101 Music, 102 Audio books, 103 Sound clips, 104 FLAC, 199 Other.
const MUSIC = ['101', '104']
const AUDIOBOOKS = '102'

const ALL_AUDIO = ['101', '102', '103', '104', '199']

/** Explore category → precompiled top-100 list and the categories it holds. */
const TOP_LISTS: Record<string, { file: string; categories: string[] }> = {
  'top-music': { file: 'data_top100_101.json', categories: ['101'] },
  'top-flac': { file: 'data_top100_104.json', categories: ['104'] },
  'top-48h': { file: 'data_top100_48h_101.json', categories: ['101'] },
  'top-audio': { file: 'data_top100_100.json', categories: ALL_AUDIO }
}

export interface ApibayItem {
  id: string
  name: string
  info_hash: string
  seeders: string | number
  leechers: string | number
  size: string | number
  added?: string | number
  category: string | number
  username?: string
  status?: string
}

const NO_RESULTS = /^0+$/

function categories(options: Options): string[] {
  if (options.flacOnly === true) return ['104']
  return options.includeAudiobooks === true ? [...MUSIC, AUDIOBOOKS] : MUSIC
}

export function toResults(items: ApibayItem[], categoryIds: string[]): TorrentResult[] {
  const wanted = new Set(categoryIds)
  return items.flatMap(item => {
    // An empty search answers with a single placeholder row whose hash is all zeroes.
    if (!item || NO_RESULTS.test(String(item.info_hash)) || !wanted.has(String(item.category))) return []
    const link = magnet(String(item.info_hash), item.name)
    if (!link) return []
    const release = parseRelease(item.name)
    const year = item.added ? new Date(Number(item.added) * 1000).getUTCFullYear() : undefined
    return [
      {
        ...release,
        year: release.year ?? (year ? String(year) : undefined),
        link,
        size: Number(item.size) || undefined,
        seeders: Number(item.seeders),
        leechers: Number(item.leechers),
        tags: [...(String(item.category) === '104' ? ['FLAC'] : []), ...(release.tags ?? []), ...(item.status === 'vip' || item.status === 'trusted' ? ['Trusted'] : [])]
          .filter((tag, i, all) => all.indexOf(tag) === i)
          .slice(0, 4)
      }
    ]
  })
}

const sortBySeeders = (results: TorrentResult[]) => results.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))

const extension: Extension = {
  async test() {
    await getJson<ApibayItem[]>(`${API}/precompiled/${TOP_LISTS['top-music'].file}`, SITE)
    return true
  },

  async search({ query, options }) {
    const q = cleanQuery(query)
    if (!q) return []
    const url = new URL('/q.php', API)
    url.searchParams.set('q', q)
    const wanted = categories(options)
    url.searchParams.set('cat', wanted.join(','))
    return sortBySeeders(toResults(await getJson<ApibayItem[]>(url, SITE), wanted)).slice(0, 50)
  },

  async browse({ category }) {
    const list = TOP_LISTS[category] ?? TOP_LISTS['top-music']
    return toResults(await getJson<ApibayItem[]>(`${API}/precompiled/${list.file}`, SITE), list.categories).slice(0, 50)
  }
}

export default extension
