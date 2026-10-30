// Where the app is: the pages back/forward move between, and what can cover the current page while an album loads.
// Pure (no React, no DOM), so it runs in unit tests.

export type SettingsSection = 'appearance' | 'sources' | 'sharing' | 'backup'

/** Pages are what back/forward move between. */
export type Page =
  | { kind: 'home' }
  | { kind: 'search'; query: string }
  | { kind: 'explore' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'saved' }
  | { kind: 'liked' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; infoHash: string }

/** Shown in place of the current page while an album loads or fails to; not part of the history. */
export type Overlay =
  | { kind: 'loading'; title?: string; artist?: string; artwork?: string }
  | { kind: 'error'; message: string; retry?: () => void }

export type View = Page | Overlay

/** Older pages are dropped beyond this many. */
export const MAX_HISTORY = 50

export interface History {
  pages: Page[]
  index: number
}

export const INITIAL_HISTORY: History = { pages: [{ kind: 'home' }], index: 0 }

export type HistoryAction = { type: 'push'; page: Page } | { type: 'back' } | { type: 'forward' }

/** Whether two pages are the same place, so navigating to the current page doesn't add a history entry. */
export function samePage(a: Page, b: Page): boolean {
  if (a.kind === 'album' && b.kind === 'album') return a.infoHash === b.infoHash
  if (a.kind === 'search' && b.kind === 'search') return a.query === b.query
  if (a.kind === 'playlist' && b.kind === 'playlist') return a.id === b.id
  if (a.kind === 'settings' && b.kind === 'settings') return a.section === b.section
  return a.kind === b.kind
}

/**
 * Browser-style history. Pushing the page already shown is a no-op; pushing anything else drops the forward pages.
 * Returns the same object when nothing changes, so React skips the re-render.
 */
export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case 'push': {
      if (samePage(h.pages[h.index], action.page)) return h
      const pages = [...h.pages.slice(0, h.index + 1), action.page].slice(-MAX_HISTORY)
      return { pages, index: pages.length - 1 }
    }
    case 'back':
      return h.index > 0 ? { ...h, index: h.index - 1 } : h
    case 'forward':
      return h.index < h.pages.length - 1 ? { ...h, index: h.index + 1 } : h
  }
}

/** Which sidebar entry to highlight: an album's info hash, `playlist:<id>`, a page kind, or nothing ('') under an overlay. */
export function sidebarKey(view: View): string {
  if (view.kind === 'album') return view.infoHash
  if (view.kind === 'playlist') return `playlist:${view.id}`
  if (view.kind === 'loading' || view.kind === 'error') return ''
  return view.kind
}
