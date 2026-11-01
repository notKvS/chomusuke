import { FetchError, fetchBodyOrMagnet } from '../http.ts'
import { sanitizeThirdPartyMagnet, stripPrivateEndpoints } from '../net.ts'
import type { ChartWanted } from '../providers/chart-match.ts'
import type { MusicProvider, Playable, ProviderResults } from '../providers/types.ts'
import { parseSource, SourceError } from '../source.ts'
import { hostAllowed, PluginError, type PluginManifest, sanitizeChartEntries, sanitizeResults } from './manifest.ts'

export type PluginMethod = 'test' | 'search' | 'browse'

/** Runs a plugin's code (in production: a sandboxed worker, see host.ts). */
export interface PluginRuntime {
  call(method: PluginMethod, args: unknown, signal?: AbortSignal): Promise<unknown>
}

/** Finds a chart entry on the torrent providers and opens it (ProviderRegistry.findRelease). */
export type FindRelease = (wanted: ChartWanted, signal?: AbortSignal) => Promise<Playable>

const TORRENT_MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000

export const pluginProviderId = (manifest: PluginManifest): string => `plugin-${manifest.id}`

function magnetOrThrow(uri: string): string {
  const source = parseSource(uri)
  if (source.kind !== 'magnet') throw new SourceError('The plugin returned an invalid magnet link.')
  return sanitizeThirdPartyMagnet(source.uri)
}

/**
 * A plugin answers with a list (one page only) or `{ results, hasMore }` when it can page. Anything else is
 * passed through so the sanitizers reject it.
 */
export function unpage(raw: unknown): { items: unknown; hasMore: boolean } {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'results' in raw) {
    const { results, hasMore } = raw as { results: unknown; hasMore?: unknown }
    return { items: results, hasMore: hasMore === true }
  }
  return { items: raw, hasMore: false }
}

/**
 * Adapts a plugin to the provider interface. Whatever the plugin returns is re-validated, and opening a result
 * downloads only from the plugin's declared hosts (or uses its magnet link), with private trackers stripped.
 * Chart plugins never supply torrents: their entries open through `findRelease`.
 */
export function createPluginProvider(
  manifest: PluginManifest,
  runtime: PluginRuntime,
  options: Record<string, string | boolean>,
  findRelease?: FindRelease
): MusicProvider {
  if (manifest.type === 'chart') return createChartProvider(manifest, runtime, options, findRelease)
  const results = async (
    method: PluginMethod,
    args: Record<string, unknown>,
    signal: AbortSignal,
    page = 1
  ): Promise<ProviderResults> => {
    const { items, hasMore } = unpage(await runtime.call(method, { ...args, page, options }, signal))
    const albums = sanitizeResults(items, manifest)
    return { albums, songs: [], hasMore: hasMore && albums.length > 0 }
  }
  const browsable = manifest.categories.length > 0

  return {
    id: pluginProviderId(manifest),
    name: manifest.name,
    layout: manifest.layout,
    search: (query, signal, page) => results('search', { query }, signal, page),
    categories: browsable ? manifest.categories : undefined,
    browse: browsable ? (category, signal, page) => results('browse', { category }, signal, page) : undefined,

    async open(album, signal): Promise<Playable> {
      let ref: { link?: string; hash?: string }
      try {
        ref = JSON.parse(album.ref)
      } catch {
        throw new SourceError('That result is no longer available.')
      }
      if (ref.link?.startsWith('magnet:'))
        return {
          kind: 'torrent',
          torrent: magnetOrThrow(ref.link),
          hints: { title: album.title, artist: album.artist }
        }
      if (ref.link) {
        try {
          // Only the hosts the plugin declared, https only.
          const result = await fetchBodyOrMagnet(ref.link, {
            maxBytes: TORRENT_MAX_BYTES,
            timeoutMs: TIMEOUT_MS,
            accept: 'application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.5',
            allowHost: host => hostAllowed(host, manifest.hosts),
            signal
          })
          const torrent =
            result.kind === 'magnet' ? magnetOrThrow(result.uri) : await stripPrivateEndpoints(result.body)
          return { kind: 'torrent', torrent, hints: { title: album.title, artist: album.artist } }
        } catch (err) {
          if (err instanceof SourceError) throw err
          if (err instanceof FetchError && err.kind === 'blocked-host') {
            throw new SourceError(`${manifest.name} tried to download from a site it didn't declare.`)
          }
          throw new SourceError(`Couldn't download that torrent from ${manifest.name}.`)
        }
      }
      if (ref.hash) return { kind: 'torrent', torrent: magnetOrThrow(`magnet:?xt=urn:btih:${ref.hash}`) }
      throw new SourceError('That result has no download link.')
    }
  }
}

/** A chart plugin: browse-only; opening an entry searches the torrent providers for it. */
function createChartProvider(
  manifest: PluginManifest,
  runtime: PluginRuntime,
  options: Record<string, string | boolean>,
  findRelease: FindRelease | undefined
): MusicProvider {
  return {
    id: pluginProviderId(manifest),
    name: manifest.name,
    layout: 'cards',
    chart: true,
    search: async () => ({ albums: [], songs: [] }),
    categories: manifest.categories,
    region: manifest.region && {
      current:
        typeof options[manifest.region.option] === 'string'
          ? String(options[manifest.region.option]).toLowerCase()
          : '',
      worldwide: manifest.region.worldwide,
      ...(manifest.region.categories ? { categories: manifest.region.categories } : {})
    },
    browse: async (category, signal, page = 1, region) => {
      // A country picked in Explore replaces the saved one for this call only.
      const asked = manifest.region && region !== undefined ? { ...options, [manifest.region.option]: region } : options
      const { items, hasMore } = unpage(await runtime.call('browse', { category, page, options: asked }, signal))
      const albums = sanitizeChartEntries(items, manifest)
      return { albums, songs: [], hasMore: hasMore && albums.length > 0 }
    },

    async open(album, signal): Promise<Playable> {
      let wanted: ChartWanted
      try {
        const ref = JSON.parse(album.ref) as Record<string, unknown>
        if (typeof ref.title !== 'string' || typeof ref.artist !== 'string') throw new Error('incomplete')
        wanted = {
          kind: ref.kind === 'song' ? 'song' : 'album',
          title: ref.title,
          artist: ref.artist,
          album: typeof ref.album === 'string' ? ref.album : undefined
        }
      } catch {
        throw new SourceError('That chart entry is no longer available.')
      }
      if (!findRelease) throw new SourceError('Charts can’t be played here.')
      return findRelease(wanted, signal)
    }
  }
}

/** Runs the plugin's own self-test; returns a user-facing message. */
export async function testPlugin(
  manifest: PluginManifest,
  runtime: PluginRuntime,
  options: Record<string, string | boolean>
): Promise<string> {
  const result = await runtime.call('test', { options })
  if (result !== true) throw new PluginError(`${manifest.name} reported a problem.`)
  return `${manifest.name} is working.`
}
