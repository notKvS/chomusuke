import { FetchError, fetchBodyOrMagnet } from '../http.ts'
import { sanitizeThirdPartyMagnet, stripPrivateEndpoints } from '../net.ts'
import type { ChartWanted } from '../providers/chart-match.ts'
import type { MusicProvider, Playable, ProviderResults } from '../providers/types.ts'
import { parseSource, SourceError } from '../source.ts'
import {
  ExtensionError,
  type ExtensionManifest,
  hostAllowed,
  sanitizeChartEntries,
  sanitizeResults
} from './manifest.ts'

export type ExtensionMethod = 'test' | 'search' | 'browse'

/** Runs an extension's code (in production: a sandboxed worker, see host.ts). */
export interface ExtensionRuntime {
  call(method: ExtensionMethod, args: unknown, signal?: AbortSignal): Promise<unknown>
}

/** Finds a chart entry on the torrent providers and opens it (ProviderRegistry.findRelease). */
export type FindRelease = (wanted: ChartWanted, signal?: AbortSignal) => Promise<Playable>

const TORRENT_MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000

export const extensionProviderId = (manifest: ExtensionManifest): string => `ext-${manifest.id}`

function magnetOrThrow(uri: string): string {
  const source = parseSource(uri)
  if (source.kind !== 'magnet') throw new SourceError('The extension returned an invalid magnet link.')
  return sanitizeThirdPartyMagnet(source.uri)
}

/**
 * An extension answers with a list (one page only) or `{ results, hasMore }` when it can page. Anything else is
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
 * Adapts an extension to the provider interface. Whatever the extension returns is re-validated, and opening a result
 * downloads only from the extension's declared hosts (or uses its magnet link), with private trackers stripped.
 * Chart extensions never supply torrents: their entries open through `findRelease`.
 */
export function createExtensionProvider(
  manifest: ExtensionManifest,
  runtime: ExtensionRuntime,
  options: Record<string, string | boolean>,
  findRelease?: FindRelease
): MusicProvider {
  if (manifest.type === 'chart') return createChartProvider(manifest, runtime, options, findRelease)
  const results = async (
    method: ExtensionMethod,
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
    id: extensionProviderId(manifest),
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
          // Only the hosts the extension declared, https only.
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

/** A chart extension: browse-only; opening an entry searches the torrent providers for it. */
function createChartProvider(
  manifest: ExtensionManifest,
  runtime: ExtensionRuntime,
  options: Record<string, string | boolean>,
  findRelease: FindRelease | undefined
): MusicProvider {
  return {
    id: extensionProviderId(manifest),
    name: manifest.name,
    layout: 'cards',
    chart: true,
    search: async () => ({ albums: [], songs: [] }),
    categories: manifest.categories,
    browse: async (category, signal, page = 1) => {
      const { items, hasMore } = unpage(await runtime.call('browse', { category, page, options }, signal))
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

/** Runs the extension's own self-test; returns a user-facing message. */
export async function testExtension(
  manifest: ExtensionManifest,
  runtime: ExtensionRuntime,
  options: Record<string, string | boolean>
): Promise<string> {
  const result = await runtime.call('test', { options })
  if (result !== true) throw new ExtensionError(`${manifest.name} reported a problem.`)
  return `${manifest.name} is working.`
}
