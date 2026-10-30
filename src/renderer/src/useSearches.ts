import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchState } from './components/SearchView'
import type { Page } from './navigation'
import type { Navigation } from './useNavigation'

/** Searches kept in memory; the oldest are dropped beyond this. */
const MAX_CACHED_SEARCHES = 20

/**
 * Search results by query, so going back to a search shows it again without re-running it. Only the latest run of a
 * query is kept, and a search dropped from the cache runs again when its page is shown.
 */
export function useSearches({ page, nav }: { page: Page; nav: Pick<Navigation, 'navigate' | 'cancelLoad'> }) {
  const { navigate, cancelLoad } = nav
  const [searches, setSearches] = useState<Record<string, SearchState>>({})
  const searchIds = useRef(new Map<string, number>())
  const nextSearchId = useRef(0)

  /** Runs a search and keeps its results; `show` also navigates to it. */
  const runSearch = useCallback(
    async (query: string, show = true) => {
      const id = ++nextSearchId.current
      searchIds.current.set(query, id)
      const store = (state: SearchState) =>
        setSearches(prev => {
          const next = { ...prev, [query]: state }
          const keys = Object.keys(next)
          for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_SEARCHES))) delete next[key]
          return next
        })
      store({ query, status: 'loading' })
      if (show) {
        cancelLoad()
        navigate({ kind: 'search', query })
      }
      const response = await window.chomusuke.search(query)
      if (searchIds.current.get(query) !== id) return
      store(
        response.ok
          ? { query, status: 'done', results: response.results }
          : { query, status: 'error', error: response.error }
      )
    },
    [navigate, cancelLoad]
  )

  // Going back to a search whose results were dropped from the cache runs it again.
  const shownQuery = page.kind === 'search' ? page.query : null
  useEffect(() => {
    if (shownQuery !== null && !searches[shownQuery]) void runSearch(shownQuery, false)
  }, [shownQuery, searches, runSearch])

  return { searches, runSearch }
}
