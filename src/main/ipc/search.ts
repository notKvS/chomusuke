import type { BrowseResponse, ExploreOverview, LoadResult, SearchResponse } from '../../shared/types.ts'
import { logger } from '../log.ts'
import { findTrack } from '../providers/chart-match.ts'
import { SourceError } from '../source.ts'
import type { IpcDeps } from './deps.ts'
import { handle, MAX_QUERY_LENGTH, toResult } from './guard.ts'
import { playableToAlbum } from './sources.ts'

const log = logger('search')

/** How long a Home row waits for the providers. */
const SHELF_SEARCH_TIMEOUT_MS = 30_000
const BAD_QUERY = 'Type a song, album or artist to search for.'
const validQuery = (raw: unknown): raw is string =>
  typeof raw === 'string' && Boolean(raw.trim()) && raw.length <= MAX_QUERY_LENGTH

/** Searching every enabled source, opening a result, and browsing sources by category on Explore. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, registry, library } = deps
  let activeSearch: AbortController | null = null
  handle('search:query', async (event, rawQuery: unknown): Promise<SearchResponse> => {
    assertTrustedSender(event)
    if (!validQuery(rawQuery)) return { ok: false, error: BAD_QUERY }
    // Only one search runs at a time; a new query cancels the previous one's requests.
    activeSearch?.abort()
    const controller = new AbortController()
    activeSearch = controller
    try {
      return { ok: true, results: await registry.search(rawQuery.trim(), controller.signal) }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, error: 'Search was replaced by a newer one.' }
      log.error('failed:', err)
      return { ok: false, error: 'Search failed. Check your connection and try again.' }
    } finally {
      if (activeSearch === controller) activeSearch = null
    }
  })

  // Home's rows search for several artists at once: they neither cancel the search box's search nor each other.
  handle('search:shelf', async (event, rawQuery: unknown): Promise<SearchResponse> => {
    assertTrustedSender(event)
    if (!validQuery(rawQuery)) return { ok: false, error: BAD_QUERY }
    try {
      return { ok: true, results: await registry.search(rawQuery.trim(), AbortSignal.timeout(SHELF_SEARCH_TIMEOUT_MS)) }
    } catch (err) {
      log.warn('shelf search failed:', err)
      return { ok: false, error: 'Search failed. Check your connection and try again.' }
    }
  })

  handle('search:open', async (event, albumId: unknown): Promise<LoadResult> => {
    assertTrustedSender(event)
    let startKey: string | undefined
    const result = await toResult(library, async () => {
      const playable = await registry.open(albumId)
      const album = await playableToAlbum(deps, playable)
      if (playable.startAt) startKey = findTrack(album.tracks, playable.startAt)
      return album
    })
    return result.ok && startKey ? { ...result, startKey } : result
  })

  handle('explore:sources', (event): ExploreOverview => {
    assertTrustedSender(event)
    return registry.explore()
  })

  handle(
    'explore:browse',
    async (
      event,
      sourceId: unknown,
      categoryId: unknown,
      page: unknown = 1,
      region?: unknown
    ): Promise<BrowseResponse> => {
      assertTrustedSender(event)
      try {
        return {
          ok: true,
          section: await registry.browse(sourceId, categoryId, AbortSignal.timeout(30_000), page, region)
        }
      } catch (err) {
        if (err instanceof SourceError) return { ok: false, error: err.message }
        log.error('explore: failed:', err)
        return { ok: false, error: 'Couldn’t load that category.' }
      }
    }
  )

  handle('search:more', async (event, sourceId: unknown, query: unknown, page: unknown): Promise<BrowseResponse> => {
    assertTrustedSender(event)
    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) return { ok: false, error: 'Search again.' }
    try {
      return { ok: true, section: await registry.searchMore(sourceId, query, page, AbortSignal.timeout(30_000)) }
    } catch (err) {
      if (err instanceof SourceError) return { ok: false, error: err.message }
      log.error('more failed:', err)
      return { ok: false, error: 'Couldn’t load more results.' }
    }
  })
}
