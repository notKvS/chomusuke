// The songs you picked to play next, ahead of the rest of the album or playlist that's playing (see useUpNext). Pure,
// so it runs in unit tests.
import type { SongRef } from '../../shared/types.ts'

/** Songs the queue holds at most; adding more is refused. */
export const MAX_UP_NEXT = 500

/**
 * A song waiting its turn. It's loaded only then: a song as the app remembers it (from a loaded album, the liked songs
 * or a playlist), or a search result (opened like a click on it; `key` picks the song inside its album).
 */
export interface UpNextItem {
  /** Unique in the queue: the same song can be queued twice */
  id: string
  title: string
  artist?: string
  artwork?: string
  source: { kind: 'song'; song: SongRef } | { kind: 'result'; albumId: string; key?: string }
}

let lastId = 0

/** A remembered song (from a loaded album, the liked songs or a playlist) as a queue entry. */
export const songItem = (song: SongRef, artwork?: string): UpNextItem => ({
  id: `q${++lastId}`,
  title: song.title,
  artist: song.artist,
  ...(artwork ? { artwork } : {}),
  source: { kind: 'song', song }
})

/** A search result as a queue entry: a song inside it (`key`), or a result that is one song (a chart song). */
export const resultItem = (result: {
  albumId: string
  key?: string
  title: string
  artist?: string
  artwork?: string
}): UpNextItem => ({
  id: `q${++lastId}`,
  title: result.title,
  artist: result.artist,
  ...(result.artwork ? { artwork: result.artwork } : {}),
  source: { kind: 'result', albumId: result.albumId, ...(result.key ? { key: result.key } : {}) }
})

/** "Play next" puts songs at the front, "Add to queue" at the end; several keep their order either way. */
export type UpNextPlacement = 'next' | 'last'

/** The queue with `added` in it, or unchanged when they don't all fit. */
export function enqueue(
  items: readonly UpNextItem[],
  added: readonly UpNextItem[],
  placement: UpNextPlacement
): UpNextItem[] {
  if (added.length === 0 || items.length + added.length > MAX_UP_NEXT) return [...items]
  return placement === 'next' ? [...added, ...items] : [...items, ...added]
}

export const removeItem = (items: readonly UpNextItem[], id: string): UpNextItem[] => items.filter(i => i.id !== id)

/** The queue with the song at `from` moved to `to`; unchanged when either is out of range. */
export function moveItem(items: readonly UpNextItem[], from: number, to: number): UpNextItem[] {
  const list = [...items]
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}
