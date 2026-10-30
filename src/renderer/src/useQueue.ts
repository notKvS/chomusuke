import { useCallback, useRef, useState } from 'react'
import type { Album, SongRef } from '../../shared/types'
import { type Queue, shuffle, stepQueue } from './queue'

/**
 * Plays a queue of songs from any torrents (a playlist, or the liked songs). Each song's torrent is loaded in the
 * background (no page change) and only that song is handed to the player, which calls `step` when it runs off the end.
 * Songs that fail to load are skipped with a toast.
 */
export function useQueue({
  playAt,
  addAlbum,
  setToast
}: {
  playAt: (album: Album, index: number) => void
  /** Called with each album loaded for the queue, so it shows in the sidebar. */
  addAlbum: (album: Album) => void
  setToast: (message: string) => void
}) {
  const [queue, setQueue] = useState<Queue | null>(null)
  const queueRef = useRef<Queue | null>(null)
  const queueLoad = useRef(0)

  const setCurrentQueue = useCallback((next: Queue | null) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  /** Loads the queue item's torrent (no page change) and plays just that song; the queue then moves on. */
  const playQueueAt = useCallback(
    async (q: Queue, position: number): Promise<void> => {
      const item = q.items[position]
      if (!item) return setCurrentQueue(null)
      const current = { ...q, position }
      setCurrentQueue(current)
      const id = ++queueLoad.current
      const result = await window.chomusuke.loadSource(item.magnet, { title: item.album, artist: item.artist })
      if (id !== queueLoad.current || queueRef.current !== current) return // something else started playing
      const track = result.ok ? result.album.tracks.find(t => t.key === item.key) : undefined
      if (!result.ok || !track) {
        setToast(`Couldn't load “${item.title}” — skipping it.`)
        return playQueueAt(current, position + 1)
      }
      const album = result.album
      addAlbum(album)
      playAt({ ...album, tracks: [track] }, 0)
    },
    [playAt, addAlbum, setToast, setCurrentQueue]
  )

  /** Moves past the end (or start) of the current song; false when there's no queue or nowhere to go. */
  const step = useCallback(
    (direction: 1 | -1): boolean => {
      const q = queueRef.current
      const position = stepQueue(q, direction)
      if (!q || position === null) return false
      void playQueueAt(q, position)
      return true
    },
    [playQueueAt]
  )

  /** Starts playing `items` from `start`, or from the top of a shuffled copy. */
  const startQueue = useCallback(
    (label: string, items: SongRef[], start: number, options: { shuffle?: boolean; playlistId?: string } = {}) => {
      const list = options.shuffle ? shuffle(items) : items
      void playQueueAt({ label, items: list, position: 0, playlistId: options.playlistId }, options.shuffle ? 0 : start)
    },
    [playQueueAt]
  )

  /** Playing from an album page or search ends any queue that was playing. */
  const playAlbumAt = useCallback(
    (album: Album, index: number) => {
      setCurrentQueue(null)
      playAt(album, index)
    },
    [playAt, setCurrentQueue]
  )

  return { queue, step, startQueue, playAlbumAt }
}
