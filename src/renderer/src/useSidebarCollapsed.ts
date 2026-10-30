import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

const SIDEBAR_KEY = 'chomusuke.sidebar-collapsed'

function savedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Collapses or expands the sidebar with a view transition: the browser animates snapshots of the old and new layout
 * on the compositor, so the page isn't laid out again on every frame the way a width transition would.
 */
function morphSidebar(update: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduced) {
    update()
    return
  }
  const root = document.documentElement
  // The sidebar and content are named only for the transition: a name makes an element a stacking context, which
  // would otherwise trap popup menus inside the content beneath the player bar.
  root.classList.add('is-morphing-sidebar')
  const transition = document.startViewTransition(() => flushSync(update))
  void transition.finished.finally(() => root.classList.remove('is-morphing-sidebar'))
}

/** Whether the sidebar shows icons only, remembered across launches; `toggle` animates the change. */
export function useSidebarCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(savedSidebarCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed))
    } catch {
      // Remembering is a convenience; the sidebar still toggles for this session.
    }
  }, [collapsed])

  const toggle = useCallback(() => morphSidebar(() => setCollapsed(v => !v)), [])
  return [collapsed, toggle]
}
