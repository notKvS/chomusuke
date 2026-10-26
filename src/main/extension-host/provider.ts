import { FetchError, fetchBodyOrMagnet } from '../http.ts'
import { sanitizeThirdPartyMagnet, stripPrivateEndpoints } from '../net.ts'
import type { MusicProvider, Playable, ProviderResults } from '../providers/types.ts'
import { parseSource, SourceError } from '../source.ts'
import { ExtensionError, type ExtensionManifest, hostAllowed, sanitizeResults } from './manifest.ts'

export type ExtensionMethod = 'test' | 'search' | 'browse'

/** Runs an extension's code (in production: a sandboxed worker, see host.ts). */
export interface ExtensionRuntime {
  call(method: ExtensionMethod, args: unknown, signal?: AbortSignal): Promise<unknown>
}

const TORRENT_MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000

export const extensionProviderId = (manifest: ExtensionManifest): string => `ext-${manifest.id}`

function magnetOrThrow(uri: string): string {
  const source = parseSource(uri)
  if (source.kind !== 'magnet') throw new SourceError('The extension returned an invalid magnet link.')
  return sanitizeThirdPartyMagnet(source.uri)
}

export function createExtensionProvider(
  manifest: ExtensionManifest,
  runtime: ExtensionRuntime,
  options: Record<string, string | boolean>
): MusicProvider {
  const results = async (
    method: ExtensionMethod,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ProviderResults> => ({
    albums: sanitizeResults(await runtime.call(method, { ...args, options }, signal), manifest),
    songs: []
  })
  const browsable = manifest.categories.length > 0

  return {
    id: extensionProviderId(manifest),
    name: manifest.name,
    layout: manifest.layout,
    search: (query, signal) => results('search', { query }, signal),
    categories: browsable ? manifest.categories : undefined,
    browse: browsable ? (category, signal) => results('browse', { category }, signal) : undefined,

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
