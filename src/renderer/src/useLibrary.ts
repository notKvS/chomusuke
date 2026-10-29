import { useCallback, useEffect, useState } from 'react'
import type { LibraryResponse, LibraryView } from '../../shared/types'

const REFRESH_MS = 2000

/** Kept and streamed albums with their seeding status, refreshed while the page using it is open. */
export function useLibrary() {
  const [library, setLibrary] = useState<LibraryView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => void window.chomusuke.getLibrary().then(setLibrary)
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  /** Shows the library a change returned, or its error. */
  const apply = useCallback((response: LibraryResponse) => {
    if (response.ok) {
      setLibrary(response.library)
      setError(null)
    } else setError(response.error)
  }, [])

  const remove = useCallback(
    async (infoHash: string) => apply(await window.chomusuke.removeFromLibrary(infoHash)),
    [apply]
  )

  return { library, error, apply, remove }
}
