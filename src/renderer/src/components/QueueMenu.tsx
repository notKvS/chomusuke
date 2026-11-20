import { useEffect, useRef, useState } from 'react'
import type { UpNextItem, UpNextPlacement } from '../upNext'
import { useUpNextActions } from '../useUpNext'
import { Icon } from './Icon'
import './AddToPlaylist.css'

/** Closes an open menu on Escape or a click outside the element the returned ref is put on. */
export function useMenuDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLSpanElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        closeRef.current()
      }
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('keydown', dismiss)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('keydown', dismiss)
    }
  }, [open])
  return ref
}

/**
 * "Play next" and "Add to queue", for a song menu (see AddToPlaylist and QueueButton). `items` is asked for only when
 * one is picked, and may come back empty when the song can't be queued any more. Renders nothing outside the app.
 */
export function QueueMenuItems({
  items,
  onDone
}: {
  items: () => UpNextItem[] | Promise<UpNextItem[]>
  onDone: () => void
}) {
  const upNext = useUpNextActions()
  if (!upNext) return null
  const pick = async (placement: UpNextPlacement) => {
    // Closed first, so a second click can't queue the song twice while it's being looked up.
    onDone()
    const picked = await items()
    if (picked.length > 0) upNext.add(picked, placement)
  }
  return (
    <>
      <button type="button" role="menuitem" className="playlist-menu__item" onClick={() => void pick('next')}>
        <Icon name="playNext" size={18} />
        <span>Play next</span>
      </button>
      <button type="button" role="menuitem" className="playlist-menu__item" onClick={() => void pick('last')}>
        <Icon name="addToQueue" size={18} />
        <span>Add to queue</span>
      </button>
    </>
  )
}

/** A button with just the queue actions, for songs that can't go in a playlist yet (search results, chart songs). */
export function QueueButton({
  items,
  label,
  className = ''
}: {
  items: () => UpNextItem[]
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useMenuDismiss(open, () => setOpen(false))
  if (!useUpNextActions()) return null
  return (
    <span className={`add-to-playlist ${className}`} ref={ref}>
      <button
        type="button"
        className="icon-button add-to-playlist__button"
        aria-label={label}
        title="Queue"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation()
          setOpen(v => !v)
        }}
      >
        <Icon name="addToQueue" size={18} />
      </button>
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only stops clicks reaching the row underneath
        <div className="playlist-menu" role="menu" onClick={event => event.stopPropagation()}>
          <QueueMenuItems items={items} onDone={() => setOpen(false)} />
        </div>
      )}
    </span>
  )
}
