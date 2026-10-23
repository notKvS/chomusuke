import { XMLParser } from 'fast-xml-parser'
import { FetchError, fetchBodyOrMagnet, fetchText } from '../http.ts'
import { parseSource, SourceError } from '../source.ts'
import type { MusicProvider, Playable, ProviderAlbum, ProviderResults } from './types.ts'

/**
 * Torznab is the search API torrent indexer managers speak (Jackett, Prowlarr, BitMagnet, NZBHydra…), and
 * what Lidarr/Sonarr use. BitTorrent trackers themselves can't be searched; this is how a client queries the
 * trackers/indexers its user has configured in one of those tools.
 * Spec: https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html
 */

export interface TorznabConfig {
  id: string
  name: string
  /** API endpoint, e.g. http://localhost:9117/api/v2.0/indexers/all/results/torznab/api */
  url: string
  apiKey: string
}

export interface TorznabItem {
  title: string
  magnet?: string
  link?: string
  infoHash?: string
  size?: number
  seeders?: number
  peers?: number
  categories: number[]
}

/** Errors whose message is safe to show the user (never includes the URL or API key). */
export class TorznabError extends Error {
  name = 'TorznabError'
}

const AUDIO_CATEGORY = 3000 // Newznab/Torznab "Audio"; 3010 MP3, 3040 Lossless, … all sit in 3000–3999
const MAX_RESULTS = 50
const MAX_QUERY_LENGTH = 200
const MAX_TITLE = 300
const SEARCH_MAX_BYTES = 5 * 1024 * 1024
const TORRENT_MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000
const INFO_HASH = /^[a-f0-9]{40}$/i
const TAG_PATTERN = /\b(FLAC|ALAC|MP3|AAC|OGG|OPUS|WAV|DSD|320|V0|V2|24[- ]?bit|16[- ]?bit|Lossless|Hi-?Res|WEB|CD|Vinyl)\b/gi

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true, // torznab:attr → attr
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: name => ['item', 'attr', 'torznab:attr', 'category'].includes(name)
})

function text(value: unknown, max = MAX_TITLE): string | undefined {
  const raw = isRecord(value) ? value['#text'] : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const clean = String(raw).replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

const count = (value: unknown): number | undefined => {
  const n = Number(text(value))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const httpUrl = (value: unknown): string | undefined => {
  const raw = text(value, 4096)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Hosts where plain http is acceptable for a self-hosted indexer: loopback, private/link-local addresses
 * and LAN-style names. Anything else must use https, since the API key travels in the query string.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  return !host.includes('.') || /\.(local|lan|home\.arpa|internal)$/.test(host)
}

/** Parses a Torznab search response into items; throws TorznabError for protocol errors. */
export function parseTorznab(xml: string): TorznabItem[] {
  // No DTDs: Torznab never needs them, and refusing them rules out entity-expansion tricks.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new TorznabError('The indexer sent an unsupported response.')
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch {
    throw new TorznabError("The indexer's response couldn't be read.")
  }
  if (!isRecord(doc)) throw new TorznabError("The indexer's response couldn't be read.")
  if (isRecord(doc.error)) {
    throw new TorznabError(`The indexer said: ${text(doc.error.description, 160) ?? `error ${text(doc.error.code, 10)}`}`)
  }
  const channel = isRecord(doc.rss) ? doc.rss.channel : undefined
  if (channel === '') return [] // <channel></channel>: no results
  if (!isRecord(channel)) throw new TorznabError("That doesn't look like a Torznab feed.")
  const items = Array.isArray(channel.item) ? channel.item : []

  const parsed: TorznabItem[] = []
  for (const item of items) {
    if (!isRecord(item)) continue
    const title = text(item.title)
    if (!title) continue
    const attrs = new Map<string, string>()
    for (const attr of Array.isArray(item.attr) ? item.attr : []) {
      if (isRecord(attr) && typeof attr.name === 'string' && typeof attr.value === 'string') attrs.set(attr.name.toLowerCase(), attr.value)
    }
    const magnet = attrs.get('magneturl')
    const infoHash = attrs.get('infohash')
    const enclosure = isRecord(item.enclosure) ? item.enclosure.url : undefined
    const categories = [...(Array.isArray(item.category) ? item.category : []), attrs.get('category')]
      .map(c => Number(text(c)))
      .filter(Number.isFinite)
    parsed.push({
      title,
      magnet: magnet && /^magnet:\?/i.test(magnet) ? magnet : undefined,
      link: httpUrl(enclosure) ?? httpUrl(item.link),
      infoHash: infoHash && INFO_HASH.test(infoHash) ? infoHash.toLowerCase() : undefined,
      size: count(item.size) ?? count(attrs.get('size')),
      seeders: count(attrs.get('seeders')),
      peers: count(attrs.get('peers')),
      categories
    })
  }
  return parsed
}

const isAudio = (item: TorznabItem): boolean =>
  item.categories.length === 0 || item.categories.some(c => c >= AUDIO_CATEGORY && c < AUDIO_CATEGORY + 1000)

export function toAlbum(item: TorznabItem): ProviderAlbum | undefined {
  if (!item.magnet && !item.link && !item.infoHash) return undefined
  const tags = [...new Set([...item.title.matchAll(TAG_PATTERN)].map(m => m[1].toUpperCase().replace(/[- ]/g, '')))]
  return {
    // Kept in the main process only: the renderer gets an opaque id for this album.
    ref: JSON.stringify({ magnet: item.magnet, link: item.link, infoHash: item.infoHash }),
    title: item.title,
    year: /[([](19\d{2}|20\d{2})[)\]]/.exec(item.title)?.[1],
    seeders: item.seeders,
    peers: item.peers,
    size: item.size,
    tags: tags.slice(0, 4)
  }
}

function searchUrl(config: TorznabConfig, params: Record<string, string>): URL {
  const url = new URL(config.url)
  url.search = ''
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  url.searchParams.set('apikey', config.apiKey)
  return url
}

function describeFetchError(err: unknown, name: string): Error {
  if (err instanceof TorznabError || err instanceof SourceError) return err
  if (err instanceof FetchError) {
    if (err.status === 401 || err.status === 403) return new TorznabError(`${name} rejected the API key.`)
    if (err.kind === 'status') return new TorznabError(`${name} answered with HTTP ${err.status}.`)
    if (err.kind === 'insecure-redirect') return new TorznabError(`${name} must use https unless it runs on your own network.`)
  }
  return new TorznabError(`Couldn't reach ${name}.`)
}

export function createTorznabProvider(config: TorznabConfig): MusicProvider {
  const indexerHost = new URL(config.url).hostname
  // Plain http only to the configured indexer itself, and only if it lives on a private network.
  const allowHttp = (hostname: string) => hostname === indexerHost && isPrivateHost(hostname)

  const request = async (params: Record<string, string>, signal?: AbortSignal) => {
    try {
      return await fetchText(searchUrl(config, params), { maxBytes: SEARCH_MAX_BYTES, timeoutMs: TIMEOUT_MS, allowHttp, signal })
    } catch (err) {
      throw describeFetchError(err, config.name)
    }
  }

  return {
    id: config.id,
    name: config.name,
    layout: 'list',

    async search(query, signal): Promise<ProviderResults> {
      const q = query.replace(/[\p{Cc}]/gu, ' ').trim().slice(0, MAX_QUERY_LENGTH)
      if (!q) return { albums: [], songs: [] }
      const xml = await request({ t: 'search', q, cat: String(AUDIO_CATEGORY), limit: String(MAX_RESULTS), extended: '1' }, signal)
      const albums = parseTorznab(xml)
        .filter(isAudio)
        .sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1))
        .map(toAlbum)
        .filter((album): album is ProviderAlbum => album !== undefined)
        .slice(0, MAX_RESULTS)
      return { albums, songs: [] }
    },

    async open(album, signal): Promise<Playable> {
      let ref: { magnet?: string; link?: string; infoHash?: string }
      try {
        ref = JSON.parse(album.ref)
      } catch {
        throw new SourceError('That search result is no longer available.')
      }
      if (ref.magnet) return { kind: 'torrent', torrent: magnetOrThrow(ref.magnet) }
      if (ref.link) {
        try {
          const result = await fetchBodyOrMagnet(ref.link, {
            maxBytes: TORRENT_MAX_BYTES,
            timeoutMs: TIMEOUT_MS,
            accept: 'application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.5',
            allowHttp,
            signal
          })
          return { kind: 'torrent', torrent: result.kind === 'magnet' ? magnetOrThrow(result.uri) : result.body }
        } catch (err) {
          throw new SourceError(describeFetchError(err, config.name).message)
        }
      }
      if (ref.infoHash) return { kind: 'torrent', torrent: magnetOrThrow(`magnet:?xt=urn:btih:${ref.infoHash}`) }
      throw new SourceError('That search result has no download link.')
    }
  }
}

function magnetOrThrow(uri: string): string {
  const source = parseSource(uri)
  if (source.kind !== 'magnet') throw new SourceError('The indexer returned an invalid magnet link.')
  return source.uri
}

/** Checks the endpoint answers Torznab capabilities with this key. */
export async function testTorznab(config: TorznabConfig, signal?: AbortSignal): Promise<string> {
  const provider = createTorznabProvider(config)
  try {
    const url = searchUrl(config, { t: 'caps' })
    const xml = await fetchText(url, {
      maxBytes: SEARCH_MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      allowHttp: host => host === url.hostname && isPrivateHost(host),
      signal
    })
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new TorznabError('The indexer sent an unsupported response.')
    const doc: unknown = parser.parse(xml)
    if (isRecord(doc) && isRecord(doc.error)) throw new TorznabError(`The indexer said: ${text(doc.error.description, 160) ?? 'error'}`)
    if (!isRecord(doc) || !('caps' in doc)) throw new TorznabError("That doesn't look like a Torznab endpoint.")
  } catch (err) {
    throw describeFetchError(err, provider.name)
  }
  return `Connected to ${provider.name}.`
}
