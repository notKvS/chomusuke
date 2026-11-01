import { fetchJson } from '../http.ts'
import type { PluginManifest } from '../plugin-host/manifest.ts'
import { createPluginProvider, type FindRelease, type PluginRuntime } from '../plugin-host/provider.ts'
import { fetchTorrentFile } from '../torrent-fetch.ts'
import { createArchiveProvider, isArchiveHost, type JsonFetcher } from './archive.ts'
import type { EnabledProvider } from './settings.ts'
import { createTorznabProvider } from './torznab.ts'
import type { MusicProvider } from './types.ts'

const ARCHIVE_TIMEOUT_MS = 10_000

/** JSON fetcher locked to https://archive.org and its subdomains. */
export const archiveJsonFetcher: JsonFetcher = (url, maxBytes, signal) =>
  fetchJson(url, { maxBytes, timeoutMs: ARCHIVE_TIMEOUT_MS, allowHost: isArchiveHost, signal })

export interface ProviderDeps {
  /** Returns the (lazily started) sandbox for a plugin's code; reused while the code is unchanged. */
  pluginRuntime(manifest: PluginManifest, code: string, codeSha256: string): PluginRuntime
  /** How chart plugins play an entry: by finding it on the other (torrent) providers. */
  findRelease: FindRelease
}

/**
 * The one place that maps saved settings to provider implementations.
 * New built-in provider type: add it to EnabledProvider/StoredProvider in settings.ts and a case here.
 * Third-party sources don't need either: they ship as plugins (see plugin-host/manifest.ts).
 */
export function buildProviders(configs: EnabledProvider[], deps: ProviderDeps): MusicProvider[] {
  return configs.map((config): MusicProvider => {
    switch (config.type) {
      case 'archive':
        return createArchiveProvider({ fetchJson: archiveJsonFetcher, fetchTorrent: fetchTorrentFile })
      case 'torznab':
        return createTorznabProvider(config)
      case 'plugin':
        return createPluginProvider(
          config.manifest,
          deps.pluginRuntime(config.manifest, config.code, config.codeSha256),
          config.options,
          deps.findRelease
        )
      default:
        throw new Error(`Unknown provider type: ${(config as { type: string }).type}`)
    }
  })
}
