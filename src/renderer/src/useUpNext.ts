import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { Album } from '../../shared/types'
import { enqueue, moveItem, removeItem, type UpNextItem, type UpNextPlacement } from './upNext'

/** What any screen needs to queue songs: see {@link useUpNext}. */
export interface UpNextActions {
  add: (items: UpNextItem[], placement: UpNextPlacement) => void
}

export const UpNextContext = createContext<UpNextActions | null>(null)

/** Queueing from any screen; null outside the app shell (where songs can't be queued). */
export const useUpNextActions = (): UpNextActions | null => useContext(UpNextContext)

/**
 * The songs you queued to play next. When the current track is done (or Next is pressed) the player asks
 * {@link playQueued} first, so they go ahead of the rest of the album or playlist; each is loaded in the background
 * then (no page change) and played on its own, like a playlist song. Once the queue is empty, {@link resume} goes back
 * to the album where it was left. The queue lasts for the session.
 */
export function useUpNext({
  playAt,
  playAfter,
  addAlbum,
  setToast,
  playing,
  onExhausted
}: {
  playAt: (album: Album, index: number) => void
  /** Plays the track after `index` of `album`; false when there's none. */
  playAfter: (album: Album, index: number) => boolean
  /** Called with each album loaded for a queued song, so it shows in the sidebar. */
  addAlbum: (album: Album) => void
  setToast: (message: string) => void
  /** What the player has now. */
  playing: () => { album: Album | null; index: number }
  /** None of the remaining queued songs could be played: carry on as if the queue had ended. */
  onExhausted: () => void
}) {
  const [items, setItemsState] = useState<UpNextItem[]>([])
  const itemsRef = useRef(items)
  const setItems = useCallback((next: UpNextItem[]) => {
    itemsRef.current = next
    setItemsState(next)
  }, [])
  /** Where the queue cut in, to go back to once it's empty: the album and the track that was playing. */
  const resumeAt = useRef<{ album: Album; index: number } | null>(null)
  /** The one-song albums the queue played: never somewhere to go back to. */
  const queuedAlbums = useRef(new WeakSet<Album>())
  const load = useRef(0)
  /** The queued song being loaded, taken off the queue but not playing yet. */
  const pending = useRef<UpNextItem | null>(null)

  const add = useCallback(
    (added: UpNextItem[], placement: UpNextPlacement) => {
      const next = enqueue(itemsRef.current, added, placement)
      if (next.length === itemsRef.current.length) {
        setToast('The queue is full. Remove some songs first.')
        return
      }
      setItems(next)
      const what = added.length === 1 ? `“${added[0].title}”` : `${added.length} songs`
      setToast(placement === 'next' ? `${what} will play next` : `Added ${what} to the queue`)
    },
    [setItems, setToast]
  )

  const remove = useCallback((id: string) => setItems(removeItem(itemsRef.current, id)), [setItems])
  const move = useCallback((from: number, to: number) => setItems(moveItem(itemsRef.current, from, to)), [setItems])
  const clear = useCallback(() => setItems([]), [setItems])

  /** Stops waiting for a queued song that's still loading: it goes back to the front of the queue. */
  const cancel = useCallback(() => {
    load.current++
    const item = pending.current
    pending.current = null
    if (item) setItems([item, ...itemsRef.current])
  }, [setItems])

  /** Plays the first queued song; false when the queue is empty. Songs that can't be found are skipped with a toast. */
  const playQueued = useCallback((): boolean => {
    const [first, ...rest] = itemsRef.current
    if (!first) return false
    setItems(rest)
    const before = playing()
    if (before.album && !queuedAlbums.current.has(before.album)) {
      resumeAt.current = { album: before.album, index: before.index }
    }
    const id = ++load.current
    pending.current = first

    void (async () => {
      const { source } = first
      const result =
        source.kind === 'song'
          ? await window.chomusuke.openSong(source.song)
          : await window.chomusuke.openResult(source.albumId)
      // Skipped (Next again took the next queued song) or cancelled (and put back): nothing more to do.
      if (id !== load.current) return
      pending.current = null
      const now = playing()
      if (now.album !== before.album || now.index !== before.index) {
        // The player moved on meanwhile (Next with nothing else queued): keep the song for later, and don't go back
        // to where it would have cut in, since the album has carried on from there.
        resumeAt.current = null
        setItems([first, ...itemsRef.current])
        return
      }
      const key = (result.ok && result.startKey) || (source.kind === 'song' ? source.song.key : source.key)
      const tracks = result.ok ? result.album.tracks : []
      // A search result opened without a song to start at is a single song, or nothing we can pick from.
      const track = key ? tracks.find(t => t.key === key) : tracks.length === 1 ? tracks[0] : undefined
      if (!result.ok || !track) {
        setToast(result.ok ? `Couldn’t find “${first.title}” — skipping it.` : `${result.error} Skipping it.`)
        if (!playQueued()) onExhausted()
        return
      }
      if (result.notice) setToast(result.notice)
      addAlbum(result.album)
      const album = { ...result.album, tracks: [track] }
      queuedAlbums.current.add(album)
      playAt(album, 0)
    })()
    return true
  }, [playing, playAt, addAlbum, setToast, setItems, onExhausted])

  /** After the last queued song: the album the queue cut into carries on. False when there's nothing to go back to. */
  const resume = useCallback((): boolean => {
    const at = resumeAt.current
    resumeAt.current = null
    return at !== null && playAfter(at.album, at.index)
  }, [playAfter])

  /** Something was picked to play: the queue no longer goes back to what played before (the queued songs stay). */
  const forgetResume = useCallback(() => {
    resumeAt.current = null
    cancel()
  }, [cancel])

  /** Whether the player is on a song the queue started (Previous then restarts it instead of stepping back). */
  const isQueuedAlbum = useCallback((album: Album | null) => album !== null && queuedAlbums.current.has(album), [])

  const actions = useMemo<UpNextActions>(() => ({ add }), [add])

  return {
    items,
    actions,
    remove,
    move,
    clear,
    playQueued,
    cancel,
    resume,
    forgetResume,
    isQueuedAlbum,
    /** The album the queue goes back to, for the panel's "Next from" list. */
    resumesFrom: () => resumeAt.current
  }
}
