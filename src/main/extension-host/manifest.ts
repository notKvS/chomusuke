import type { SourceCategory } from '../../shared/types.ts'
import type { ProviderAlbum } from '../providers/types.ts'

/**
 * Extensions add sources. Users import a repository (a JSON manifest listing extensions); each extension is a
 * bundled ES module that runs in a sandboxed worker. The manifest declares which https hosts it may contact.
 * - `"type": "torrent"` extensions turn queries and Explore categories into torrent results.
 * - `"type": "chart"` extensions list top albums/songs from a public chart (browse only, at least one category);
 *   the app plays an entry by searching the torrent sources for it (ProviderRegistry.findRelease).
 *
 * Manifest (array of these, or { "extensions": [...] }):
 * {
 *   "manifestVersion": 1, "id": "my-source", "name": "My Source", "version": "1.0.0", "type": "torrent" | "chart",
 *   "description": "…", "code": "extension.js",          // relative to the manifest URL
 *   "hosts": ["example.org", "*.example.org"],          // the only hosts the code may reach (https)
 *   "layout": "list" | "cards",                         // charts are always cards
 *   "categories": [{ "id": "top", "name": "Top this week" }],
 *   "options": { "apiKey": { "type": "string", "label": "API key", "secret": true } },
 *   "enabledByDefault": false                           // optional: install switched off (default true)
 * }
 *
 * Extension module: export default {
 *   test?(ctx) → true | throw, search(ctx: { query, page, options }) → TorrentResult[],
 *   browse?(ctx: { category, page, options }) → TorrentResult[]      (chart: browse → ChartEntry[], no search)
 * }
 * Any list may instead be `{ results: [...], hasMore: true }` to offer the next page (`page` starts at 1).
 * TorrentResult: { title, link?: magnet | https .torrent URL, hash?: 40-hex, size?, seeders?, leechers?,
 *                  artist?, year?, artwork?: https URL, tags?: string[] }  (link or hash required)
 * ChartEntry: { kind: 'album' | 'song', title, artist, album?: string (songs), year?, artwork?, tags? }
 */

export interface ExtensionOption {
  type: 'string' | 'boolean'
  label: string
  description?: string
  secret: boolean
  default?: string | boolean
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  /** torrent: search/browse torrents; chart: browse top albums/songs that play through the torrent sources */
  type: 'torrent' | 'chart'
  description: string
  codeUrl: string
  hosts: string[]
  layout: 'cards' | 'list'
  categories: SourceCategory[]
  options: Record<string, ExtensionOption>
  /** Whether a fresh install starts switched on. */
  enabledByDefault: boolean
}

/** Extension-provided errors that are safe to show to the user. */
export class ExtensionError extends Error {
  name = 'ExtensionError'
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const HOST = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const INFO_HASH = /^[a-f0-9]{40}$/i
const MAX_EXTENSIONS = 20
const MAX_HOSTS = 10
const MAX_CATEGORIES = 20
const MAX_OPTIONS = 10
const MAX_RESULTS = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const clean = String(value)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
  return clean ? clean.slice(0, max) : undefined
}

const requireText = (value: unknown, max: number, what: string): string => {
  const result = text(value, max)
  if (!result) throw new ExtensionError(`The extension manifest is missing ${what}.`)
  return result
}

/** `*.example.org` matches subdomains only; `example.org` matches exactly. */
export function hostAllowed(hostname: string, hosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return hosts.some(pattern => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern))
}

function parseOne(raw: unknown, base: URL, sameOriginHttp: boolean): ExtensionManifest {
  if (!isRecord(raw)) throw new ExtensionError('The extension manifest is malformed.')
  if (raw.manifestVersion !== 1) throw new ExtensionError('Unsupported extension manifest version.')
  if (raw.type !== 'torrent' && raw.type !== 'chart')
    throw new ExtensionError('Only torrent and chart extensions are supported.')
  const type = raw.type
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : undefined
  if (!id) throw new ExtensionError('The extension has an invalid id.')

  const codeUrl = new URL(requireText(raw.code, 2048, 'its code URL'), base)
  const codeOk = codeUrl.protocol === 'https:' || (sameOriginHttp && codeUrl.origin === base.origin)
  if (!codeOk) throw new ExtensionError('Extension code must be served over https.')

  const hosts = Array.isArray(raw.hosts) ? raw.hosts.map(h => String(h).toLowerCase()) : []
  if (hosts.length === 0 || hosts.length > MAX_HOSTS || !hosts.every(h => HOST.test(h))) {
    throw new ExtensionError('The extension must list the web hosts it uses.')
  }

  const categories: SourceCategory[] = []
  for (const category of Array.isArray(raw.categories) ? raw.categories.slice(0, MAX_CATEGORIES) : []) {
    if (!isRecord(category) || typeof category.id !== 'string' || !ID.test(category.id)) continue
    categories.push({ id: category.id, name: text(category.name, 40) ?? category.id })
  }
  if (type === 'chart' && categories.length === 0) throw new ExtensionError('A chart extension needs categories.')

  const options: Record<string, ExtensionOption> = {}
  const rawOptions = isRecord(raw.options) ? Object.entries(raw.options).slice(0, MAX_OPTIONS) : []
  for (const [key, option] of rawOptions) {
    if (!OPTION_KEY.test(key) || !isRecord(option) || (option.type !== 'string' && option.type !== 'boolean')) continue
    const fallback = option.type === 'boolean' ? option.default === true : text(option.default, 500)
    options[key] = {
      type: option.type,
      label: text(option.label, 60) ?? key,
      description: text(option.description, 200),
      secret: option.secret === true && option.type === 'string',
      default: option.secret === true ? undefined : fallback
    }
  }

  return {
    id,
    name: requireText(raw.name, 60, 'a name'),
    version: requireText(raw.version, 20, 'a version'),
    type,
    description: text(raw.description, 300) ?? '',
    codeUrl: codeUrl.toString(),
    hosts: [...new Set(hosts)],
    layout: raw.layout === 'cards' || type === 'chart' ? 'cards' : 'list',
    categories,
    options,
    enabledByDefault: raw.enabledByDefault !== false
  }
}

/**
 * Validates a repository manifest. `sameOriginHttp` allows http code URLs on the repository's own origin
 * (only used for repositories served from the user's own network).
 */
export function parseRepository(json: unknown, repositoryUrl: string, sameOriginHttp = false): ExtensionManifest[] {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.extensions) ? json.extensions : null
  if (!list || list.length === 0) throw new ExtensionError('That doesn’t look like an extension repository.')
  if (list.length > MAX_EXTENSIONS) throw new ExtensionError('That repository lists too many extensions.')
  const base = new URL(repositoryUrl)
  const manifests = list.map(item => parseOne(item, base, sameOriginHttp))
  if (new Set(manifests.map(m => m.id)).size !== manifests.length)
    throw new ExtensionError('The repository lists an extension twice.')
  return manifests
}

const count = (value: unknown): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const yearOf = (value: unknown): string | undefined => /^\d{4}$/.exec(text(value, 4) ?? '')?.[0]

const tagList = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value
        .map(t => text(t, 12))
        .filter((t): t is string => Boolean(t))
        .slice(0, 4)
    : undefined

/** Turns untrusted extension output into albums; anything malformed is dropped. */
export function sanitizeResults(raw: unknown, manifest: ExtensionManifest): ProviderAlbum[] {
  if (!Array.isArray(raw)) throw new ExtensionError(`${manifest.name} returned an invalid response.`)
  const albums: ProviderAlbum[] = []
  for (const item of raw.slice(0, MAX_RESULTS)) {
    if (!isRecord(item)) continue
    const title = text(item.title, 300)
    if (!title) continue

    const rawLink = typeof item.link === 'string' ? item.link.trim() : ''
    let link: string | undefined
    if (/^magnet:\?/i.test(rawLink) && rawLink.length <= 8192) link = rawLink
    else if (rawLink) {
      try {
        const url = new URL(rawLink)
        if (url.protocol === 'https:' && url.port === '' && hostAllowed(url.hostname, manifest.hosts))
          link = url.toString()
      } catch {
        // ignore unusable links
      }
    }
    const hash = typeof item.hash === 'string' && INFO_HASH.test(item.hash) ? item.hash.toLowerCase() : undefined
    if (!link && !hash) continue

    albums.push({
      ref: JSON.stringify({ link, hash }),
      title,
      artist: text(item.artist, 120),
      year: yearOf(item.year),
      artwork: httpsUrl(item.artwork),
      seeders: count(item.seeders),
      peers: count(item.leechers),
      size: count(item.size),
      tags: tagList(item.tags)
    })
  }
  return albums
}

/**
 * Turns untrusted chart extension output into chart entries; each needs a title and an artist to search for.
 * The ref holds what to search the torrent sources for (see ChartWanted in providers/chart-match.ts).
 */
export function sanitizeChartEntries(raw: unknown, manifest: ExtensionManifest): ProviderAlbum[] {
  if (!Array.isArray(raw)) throw new ExtensionError(`${manifest.name} returned an invalid response.`)
  const entries: ProviderAlbum[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, MAX_RESULTS)) {
    if (!isRecord(item)) continue
    const title = text(item.title, 200)
    const artist = text(item.artist, 120)
    if (!title || !artist) continue
    const kind = item.kind === 'song' ? 'song' : 'album'
    const album = kind === 'song' ? text(item.album, 200) : undefined
    const ref = JSON.stringify({ kind, title, artist, album })
    if (seen.has(ref)) continue
    seen.add(ref)
    entries.push({
      ref,
      title,
      artist,
      year: yearOf(item.year),
      artwork: httpsUrl(item.artwork),
      tags: tagList(item.tags),
      chart: kind
    })
  }
  return entries
}
