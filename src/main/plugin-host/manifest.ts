import type { PluginKind, SourceCategory } from '../../shared/types.ts'
import type { HttpTrack, ProviderAlbum } from '../providers/types.ts'

/**
 * Plugins add sources. Users import a repository (a JSON manifest listing plugins); each plugin is a
 * bundled ES module that runs in a sandboxed worker. The manifest declares which https hosts it may contact.
 * - `"type": "torrent"` plugins are providers: they turn queries into torrent results.
 * - `"type": "stream"` plugins are providers too, for services with direct audio URLs: search returns results with
 *   an `id`, and `open` turns one into tracks with https URLs (played by HttpSource, see http-source.ts).
 * - `"type": "chart"` plugins list top albums/songs from a public chart for Explore (browse only, at least one
 *   category); the app plays an entry by searching the providers for it (ProviderRegistry.findRelease).
 *
 * Manifest (array of these, or { "plugins": [...] }):
 * {
 *   "manifestVersion": 1, "id": "my-source", "name": "My Source", "version": "1.0.0", "type": "torrent" | "chart",
 *   "description": "…", "code": "plugin.js",          // relative to the manifest URL
 *   "hosts": ["example.org", "*.example.org"],          // the only hosts the code may reach (https)
 *   "layout": "list" | "cards",                         // charts are always cards
 *   "categories": [{ "id": "top", "name": "Top this week" }],
 *   "options": { "apiKey": { "type": "string", "label": "API key", "secret": true, "required": true,
 *                "placeholder": "Paste it here" } },   // required: Settings asks for it when the plugin is switched on
 *   "enabledByDefault": false,                          // optional: install switched off (default true)
 *   "setup": "Sign in with your account.",              // optional: shown in the window that asks for the options
 *   "session": true                                     // optional: stay signed in (cookies kept in memory while running)
 * }
 *
 * Plugin module: export default {
 *   test?(ctx) → true | throw, search(ctx: { query, page, options }) → TorrentResult[],
 *   browse?(ctx: { category, page, options }) → TorrentResult[]      (chart: browse → ChartEntry[], no search)
 * }
 * Any list may instead be `{ results: [...], hasMore: true }` to offer the next page (`page` starts at 1).
 * TorrentResult: { title, link?: magnet | https .torrent URL, hash?: 40-hex, size?, seeders?, leechers?,
 *                  artist?, year?, artwork?: https URL, tags?: string[] }  (link or hash required)
 * ChartEntry: { kind: 'album' | 'song', title, artist, album?: string (songs), year?, artwork?, tags? }
 */

export interface PluginOption {
  type: 'string' | 'boolean'
  label: string
  description?: string
  secret: boolean
  default?: string | boolean
  /** Text options only: the plugin does nothing until the user fills this in (Settings asks when it is switched on). */
  required: boolean
  /** Grey hint inside the empty field */
  placeholder?: string
}

export interface PluginRegion {
  /** The (non-secret, text) option that holds a two-letter country code */
  option: string
  /** Whether "" asks for the worldwide list */
  worldwide: boolean
  /** The categories that follow the country; all of them when left out */
  categories?: string[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  /**
   * torrent: search/browse torrents; stream: search/browse a service with direct audio URLs;
   * chart: browse top albums/songs that play through the providers
   */
  type: 'torrent' | 'stream' | 'chart'
  description: string
  codeUrl: string
  hosts: string[]
  layout: 'cards' | 'list'
  categories: SourceCategory[]
  options: Record<string, PluginOption>
  /** Shown at the top of the setup window, e.g. what the plugin needs the details for. */
  setup?: string
  /** Keeps the cookies the sites set (in memory, per plugin) so the plugin can stay signed in while the app runs. */
  session: boolean
  /** Charts: which option takes a country, so Explore can offer a country picker. */
  region?: PluginRegion
  /** Whether a fresh install starts switched on. */
  enabledByDefault: boolean
}

/** The labels of the required options that have no value yet. */
export function missingRequired(manifest: PluginManifest, values: Record<string, string | boolean>): string[] {
  return Object.entries(manifest.options)
    .filter(([key, option]) => option.required && !(typeof values[key] === 'string' && values[key].trim() !== ''))
    .map(([, option]) => option.label)
}

/** The plugins of one kind; a repository with only the other kind says where it belongs. */
export function forKind<T extends { manifest: PluginManifest }>(installs: T[], kind: PluginKind): T[] {
  const matching = installs.filter(({ manifest }) => (manifest.type === 'chart') === (kind === 'chart'))
  if (matching.length > 0) return matching
  throw new PluginError(
    kind === 'chart'
      ? 'That repository has plugins, not charts. Add it under Settings → Plugins.'
      : 'That repository has charts, not plugins. Add it under Settings → Charts.'
  )
}

/** Plugin-provided errors that are safe to show to the user. */
export class PluginError extends Error {
  name = 'PluginError'
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const HOST = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const INFO_HASH = /^[a-f0-9]{40}$/i
const MAX_PLUGINS = 20
const MAX_HOSTS = 10
const MAX_CATEGORIES = 20
const MAX_OPTIONS = 10
const MAX_RESULTS = 100
const MAX_STREAM_ID = 300
const MAX_STREAM_TRACKS = 500

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
  if (!result) throw new PluginError(`The plugin manifest is missing ${what}.`)
  return result
}

/** `*.example.org` matches subdomains only; `example.org` matches exactly. */
export function hostAllowed(hostname: string, hosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return hosts.some(pattern => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern))
}

function parseOne(raw: unknown, base: URL, sameOriginHttp: boolean): PluginManifest {
  if (!isRecord(raw)) throw new PluginError('The plugin manifest is malformed.')
  if (raw.manifestVersion !== 1) throw new PluginError('Unsupported plugin manifest version.')
  if (raw.type !== 'torrent' && raw.type !== 'stream' && raw.type !== 'chart')
    throw new PluginError('Only torrent, stream and chart plugins are supported.')
  const type = raw.type
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : undefined
  if (!id) throw new PluginError('The plugin has an invalid id.')

  const codeUrl = new URL(requireText(raw.code, 2048, 'its code URL'), base)
  const codeOk = codeUrl.protocol === 'https:' || (sameOriginHttp && codeUrl.origin === base.origin)
  if (!codeOk) throw new PluginError('Plugin code must be served over https.')

  const hosts = Array.isArray(raw.hosts) ? raw.hosts.map(h => String(h).toLowerCase()) : []
  if (hosts.length === 0 || hosts.length > MAX_HOSTS || !hosts.every(h => HOST.test(h))) {
    throw new PluginError('The plugin must list the web hosts it uses.')
  }

  const categories: SourceCategory[] = []
  for (const category of Array.isArray(raw.categories) ? raw.categories.slice(0, MAX_CATEGORIES) : []) {
    if (!isRecord(category) || typeof category.id !== 'string' || !ID.test(category.id)) continue
    categories.push({ id: category.id, name: text(category.name, 40) ?? category.id })
  }
  if (type === 'chart' && categories.length === 0) throw new PluginError('A chart plugin needs categories.')

  const options: Record<string, PluginOption> = {}
  const rawOptions = isRecord(raw.options) ? Object.entries(raw.options).slice(0, MAX_OPTIONS) : []
  for (const [key, option] of rawOptions) {
    if (!OPTION_KEY.test(key) || !isRecord(option) || (option.type !== 'string' && option.type !== 'boolean')) continue
    const fallback = option.type === 'boolean' ? option.default === true : text(option.default, 500)
    options[key] = {
      type: option.type,
      label: text(option.label, 60) ?? key,
      description: text(option.description, 200),
      secret: option.secret === true && option.type === 'string',
      default: option.secret === true ? undefined : fallback,
      required: option.required === true && option.type === 'string',
      placeholder: text(option.placeholder, 100)
    }
  }

  let region: PluginRegion | undefined
  if (type === 'chart' && isRecord(raw.region) && typeof raw.region.option === 'string') {
    const option = options[raw.region.option]
    if (option?.type === 'string' && !option.secret) {
      const known = new Set(categories.map(c => c.id))
      const followed = Array.isArray(raw.region.categories)
        ? raw.region.categories.filter((c): c is string => typeof c === 'string' && known.has(c))
        : undefined
      region = {
        option: raw.region.option,
        worldwide: raw.region.worldwide === true,
        ...(followed?.length ? { categories: followed } : {})
      }
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
    layout: raw.layout === 'cards' || type !== 'torrent' ? 'cards' : 'list',
    categories,
    options,
    setup: text(raw.setup, 400),
    session: raw.session === true,
    ...(region ? { region } : {}),
    enabledByDefault: raw.enabledByDefault !== false
  }
}

/**
 * Validates a repository manifest. `sameOriginHttp` allows http code URLs on the repository's own origin
 * (only used for repositories served from the user's own network).
 */
export function parseRepository(json: unknown, repositoryUrl: string, sameOriginHttp = false): PluginManifest[] {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.plugins) ? json.plugins : null
  if (!list || list.length === 0) throw new PluginError('That doesn’t look like a plugin repository.')
  if (list.length > MAX_PLUGINS) throw new PluginError('That repository lists too many plugins.')
  const base = new URL(repositoryUrl)
  const manifests = list.map(item => parseOne(item, base, sameOriginHttp))
  if (new Set(manifests.map(m => m.id)).size !== manifests.length)
    throw new PluginError('The repository lists a plugin twice.')
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

/** Turns untrusted plugin output into albums; anything malformed is dropped. */
export function sanitizeResults(raw: unknown, manifest: PluginManifest): ProviderAlbum[] {
  if (!Array.isArray(raw)) throw new PluginError(`${manifest.name} returned an invalid response.`)
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
 * Turns untrusted chart plugin output into chart entries; each needs a title and an artist to search for.
 * The ref holds what to search the providers for (see ChartWanted in providers/chart-match.ts).
 */
export function sanitizeChartEntries(raw: unknown, manifest: PluginManifest): ProviderAlbum[] {
  if (!Array.isArray(raw)) throw new PluginError(`${manifest.name} returned an invalid response.`)
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

/**
 * Turns untrusted stream plugin results into albums. A result needs a title and an `id`: whatever the plugin needs
 * to find the tracks again when `open` is called (a track id, an album id). Nothing else is trusted as a locator.
 */
export function sanitizeStreamResults(raw: unknown, manifest: PluginManifest): ProviderAlbum[] {
  if (!Array.isArray(raw)) throw new PluginError(`${manifest.name} returned an invalid response.`)
  const albums: ProviderAlbum[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, MAX_RESULTS)) {
    if (!isRecord(item)) continue
    const title = text(item.title, 300)
    const id = text(item.id, MAX_STREAM_ID)
    if (!title || !id || seen.has(id)) continue
    seen.add(id)
    albums.push({
      ref: JSON.stringify({ id }),
      title,
      artist: text(item.artist, 120),
      year: yearOf(item.year),
      artwork: httpsUrl(item.artwork),
      size: count(item.size),
      tags: tagList(item.tags)
    })
  }
  return albums
}

/** Request headers a stream plugin may ask us to send with the audio requests. */
export const HTTP_HEADERS = new Set(['user-agent', 'referer', 'origin', 'accept-language', 'cookie', 'authorization'])
const HEADER_VALUE = /^[\x20-\x7e]{1,2000}$/
const AUDIO_MIME = /^audio\/[a-z0-9.+-]{1,40}$/i

export interface StreamAlbum {
  title?: string
  artist?: string
  coverUrl?: string
  tracks: HttpTrack[]
}

/**
 * Turns the answer of a stream plugin's `open` into tracks. Each track's URL must be https with no port, on a host
 * the manifest declares (redirects from there may go anywhere public: see HttpSource). Headers are limited to
 * {@link HTTP_HEADERS}.
 */
export function sanitizeStreamAlbum(raw: unknown, manifest: PluginManifest): StreamAlbum {
  if (!isRecord(raw) || !Array.isArray(raw.tracks))
    throw new PluginError(`${manifest.name} returned an invalid response.`)
  const tracks: HttpTrack[] = []
  for (const item of raw.tracks.slice(0, MAX_STREAM_TRACKS)) {
    if (!isRecord(item)) continue
    const title = text(item.title, 300)
    let url: string | undefined
    try {
      const parsed = new URL(String(item.url))
      if (
        parsed.protocol === 'https:' &&
        parsed.port === '' &&
        !parsed.username &&
        !parsed.password &&
        hostAllowed(parsed.hostname, manifest.hosts)
      )
        url = parsed.toString()
    } catch {
      // unusable URL
    }
    if (!title || !url) continue

    let headers: Record<string, string> | undefined
    if (isRecord(item.headers)) {
      const entries = Object.entries(item.headers).filter(
        (pair): pair is [string, string] =>
          HTTP_HEADERS.has(pair[0].toLowerCase()) && typeof pair[1] === 'string' && HEADER_VALUE.test(pair[1])
      )
      if (entries.length > 0) headers = Object.fromEntries(entries)
    }
    const duration = count(item.duration)
    tracks.push({
      title,
      artist: text(item.artist, 120),
      url,
      headers,
      duration: duration !== undefined && duration <= 86_400 ? duration : undefined,
      mime: typeof item.mime === 'string' && AUDIO_MIME.test(item.mime) ? item.mime.toLowerCase() : undefined,
      format: text(item.format, 8)?.toUpperCase()
    })
  }
  if (tracks.length === 0) throw new PluginError(`${manifest.name} found nothing to play there.`)
  return {
    title: text(raw.title, 300),
    artist: text(raw.artist, 120),
    coverUrl: httpsUrl(raw.artwork),
    tracks
  }
}
