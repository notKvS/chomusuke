import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { historyReducer, INITIAL_HISTORY, type Overlay, type Page, type View } from './navigation'

/**
 * Browser-style navigation: history with back/forward (also on the mouse side buttons and Alt+←/→), an overlay that
 * covers the page while an album loads, and the scroll position of every page visited.
 *
 * Album loads are cancelled by a token: `beginLoad` hands out a check that turns false once anything newer starts or
 * the user navigates away with back/forward or `goTo`. `navigate` alone doesn't cancel, since a finished load calls it.
 */
export function useNavigation() {
  const [history, dispatch] = useReducer(historyReducer, INITIAL_HISTORY)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const requestId = useRef(0)
  const contentRef = useRef<HTMLElement>(null)
  /** Scroll position per page, restored when going back or forward. */
  const scrolls = useRef(new WeakMap<object, number>())

  const page = history.pages[history.index]
  const view: View = overlay ?? page

  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: scrolls.current.get(view) ?? 0 })
  }, [view])

  /** Abandons any album load in flight. */
  const cancelLoad = useCallback(() => {
    requestId.current++
  }, [])

  /** Starts an album load; the returned check is false once the load has been superseded. */
  const beginLoad = useCallback(() => {
    const id = ++requestId.current
    return () => id === requestId.current
  }, [])

  const navigate = useCallback((next: Page) => {
    setOverlay(null)
    dispatch({ type: 'push', page: next })
  }, [])

  /** Navigates on the user's behalf, abandoning any album load in flight. */
  const goTo = useCallback(
    (next: Page) => {
      requestId.current++
      navigate(next)
    },
    [navigate]
  )

  const goBack = useCallback(() => {
    requestId.current++
    if (overlay) return setOverlay(null)
    dispatch({ type: 'back' })
  }, [overlay])

  const goForward = useCallback(() => {
    requestId.current++
    setOverlay(null)
    dispatch({ type: 'forward' })
  }, [])

  // Mouse back/forward buttons and Alt+Left/Right, like a browser.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack()
      else if (e.button === 4) goForward()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') goBack()
      else goForward()
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [goBack, goForward])

  const rememberScroll = useCallback((top: number) => scrolls.current.set(view, top), [view])

  return {
    page,
    overlay,
    view,
    setOverlay,
    navigate,
    goTo,
    goBack,
    goForward,
    canGoBack: overlay !== null || history.index > 0,
    canGoForward: history.index < history.pages.length - 1,
    beginLoad,
    cancelLoad,
    /** Attach to the scrolling content element, with `rememberScroll` on its scroll event. */
    contentRef,
    rememberScroll
  }
}

export type Navigation = ReturnType<typeof useNavigation>
