// Knaben: a meta-search engine that indexes many public trackers (TPB, 1337x, Nyaa, LimeTorrents, …) behind one
// JSON API, so one request covers them all. Template: off by default and not tested against the live site.
// API: POST https://api.knaben.org/v1 with a JSON body.

import { cleanQuery, getJson, magnet, parseRelease } from './lib/torrent-kit.ts'
import type { Extension, Options, TorrentResult } from './sdk.ts'

const API = 'https://api.knaben.org/v1'
const SITE = 'Knaben'

// Knaben categories: 1000000 Audio, 1001000 MP3, 1002000 Lossless, 1003000 Audiobook, 1004000 Video,
// 1005000 Radio, 1006000 Other.
const AUDIO = 1000000
const MP3 = 1001000
const LOSSLESS = 1002000
const AUDIOBOOK = 1003000
const VIDEO = 1004000

const BROWSE: Record<string, { categories: number[]; order: 'seeders' | 'date' }> = {
  'lossless-top': { categories: [LOSSLESS], order: 'seeders' },
  'mp3-top': { categories: [MP3], order: 'seeders' },
  latest: { categories: [MP3, LOSSLESS], order: 'date' }
}

export interface KnabenHit {
  title: string
  hash?: string
  magnetUrl?: string
  bytes?: number
  seeders?: number
  peers?: number
  date?: string
  tracker?: string
  categoryId?: number[]
}

interface KnabenResponse {
  hits?: KnabenHit[]
}

export function toResults(hits: KnabenHit[], options: Options): TorrentResult[] {
  return hits.flatMap(hit => {
    if (!hit?.title) return []
    const ids = hit.categoryId ?? []
    if (options.includeAudiobooks !== true && ids.includes(AUDIOBOOK)) return []
    if (ids.includes(VIDEO)) return []
    const link = hit.magnetUrl?.startsWith('magnet:?')
      ? hit.magnetUrl
      : hit.hash
        ? magnet(hit.hash, hit.title)
        : undefined
    if (!link) return []
    const release = parseRelease(hit.title)
    const tags = [
      ...(ids.includes(LOSSLESS) ? ['Lossless'] : []),
      ...(release.tags ?? []),
      ...(hit.tracker ? [hit.tracker] : [])
    ]
    return [
      {
        ...release,
        year: release.year ?? (hit.date ? /^\d{4}/.exec(hit.date)?.[0] : undefined),
        link,
        size: hit.bytes,
        seeders: hit.seeders,
        leechers: hit.peers,
        tags: [...new Set(tags)].slice(0, 4)
      }
    ]
  })
}

async function query(body: Record<string, unknown>): Promise<KnabenHit[]> {
  const response = await getJson<KnabenResponse>(API, SITE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 0, size: 60, hide_unsafe: true, hide_xxx: true, ...body })
  })
  return Array.isArray(response.hits) ? response.hits : []
}

const extension: Extension = {
  async test() {
    await query({ categories: [AUDIO], order_by: 'date', order_direction: 'desc', size: 1 })
    return true
  },

  async search({ query: text, options }) {
    const q = cleanQuery(text)
    if (!q) return []
    const categories = options.losslessOnly === true ? [LOSSLESS] : [AUDIO]
    const hits = await query({
      search_type: '100%',
      search_field: 'title',
      query: q,
      categories,
      order_by: 'seeders',
      order_direction: 'desc'
    })
    return toResults(hits, options)
  },

  async browse({ category, options }) {
    const { categories, order } = BROWSE[category] ?? BROWSE['lossless-top']
    return toResults(await query({ categories, order_by: order, order_direction: 'desc' }), options)
  }
}

export default extension
