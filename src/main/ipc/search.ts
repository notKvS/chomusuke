import { ipcMain } from 'electron'
import type { BrowseResponse, ExploreSource, SearchResponse } from '../../shared/types.ts'
import { SourceError } from '../source.ts'
import type { IpcDeps } from './deps.ts'
import { MAX_QUERY_LENGTH, toResult } from './guard.ts'
import { playableToAlbum } from './sources.ts'

/** Searching every enabled source, opening a result, and browsing sources by category on Explore. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, registry, library } = deps
  let activeSearch: AbortController | null = null
  ipcMain.handle('search:query', async (event, rawQuery: unknown): Promise<SearchResponse> => {
    assertTrustedSender(event)
    if (typeof rawQuery !== 'string' || !rawQuery.trim() || rawQuery.length > MAX_QUERY_LENGTH) {
      return { ok: false, error: 'Type a song, album or artist to search for.' }
    }
    // Only one search runs at a time; a new query cancels the previous one's requests.
    activeSearch?.abort()
    const controller = new AbortController()
    activeSearch = controller
    try {
      return { ok: true, results: await registry.search(rawQuery.trim(), controller.signal) }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, error: 'Search was replaced by a newer one.' }
      console.error('[search] failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Search failed. Check your connection and try again.' }
    } finally {
      if (activeSearch === controller) activeSearch = null
    }
  })

  ipcMain.handle('search:open', (event, albumId: unknown) => {
    assertTrustedSender(event)
    return toResult(library, async () => playableToAlbum(torrents, await registry.open(albumId)))
  })

  ipcMain.handle('explore:sources', (event): ExploreSource[] => {
    assertTrustedSender(event)
    return registry.explore()
  })

  ipcMain.handle('explore:browse', async (event, sourceId: unknown, categoryId: unknown): Promise<BrowseResponse> => {
    assertTrustedSender(event)
    try {
      return { ok: true, section: await registry.browse(sourceId, categoryId, AbortSignal.timeout(30_000)) }
    } catch (err) {
      if (err instanceof SourceError) return { ok: false, error: err.message }
      console.error('[explore] failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Couldn’t load that category.' }
    }
  })
}
