import { fetchJson } from '../http.ts'
import { fetchTorrentFile } from '../torrent-fetch.ts'
import { createArchiveProvider, isArchiveHost, type JsonFetcher } from './archive.ts'
import type { EnabledProvider } from './settings.ts'
import { createTorznabProvider } from './torznab.ts'
import type { MusicProvider } from './types.ts'

const ARCHIVE_TIMEOUT_MS = 10_000

/** JSON fetcher locked to https://archive.org and its subdomains. */
export const archiveJsonFetcher: JsonFetcher = (url, maxBytes, signal) =>
  fetchJson(url, { maxBytes, timeoutMs: ARCHIVE_TIMEOUT_MS, allowHost: isArchiveHost, signal })

/**
 * The one place that maps saved settings to provider implementations.
 * New provider type: add it to EnabledProvider/StoredProvider in settings.ts and a case here.
 */
export function buildProviders(configs: EnabledProvider[]): MusicProvider[] {
  return configs.map(config => {
    switch (config.type) {
      case 'archive':
        return createArchiveProvider({ fetchJson: archiveJsonFetcher, fetchTorrent: fetchTorrentFile })
      case 'torznab':
        return createTorznabProvider(config)
    }
  })
}
