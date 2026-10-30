// A list of songs from any torrents, played in order (a playlist, or the liked songs). Pure, so it runs in unit tests.
import type { SongRef } from '../../shared/types.ts'

/** What's playing from a list: the songs in play order and the index of the current one. */
export interface Queue {
  label: string
  playlistId?: string
  items: SongRef[]
  position: number
}

/** A shuffled copy (Fisher–Yates). `random` returns [0, 1) like Math.random, and is swappable for tests. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** The position one step forward (1) or back (-1), or null past either end of the queue. */
export function stepQueue(queue: Queue | null, direction: 1 | -1): number | null {
  if (!queue) return null
  const position = queue.position + direction
  return position >= 0 && position < queue.items.length ? position : null
}

/** Whether the player's next/previous buttons have somewhere to go. */
export function queueEdges(queue: Queue): { hasNext: boolean; hasPrev: boolean } {
  return { hasNext: queue.position + 1 < queue.items.length, hasPrev: queue.position > 0 }
}
