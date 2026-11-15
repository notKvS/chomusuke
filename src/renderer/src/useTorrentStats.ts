import { useSyncExternalStore } from 'react'
import type { TorrentStats } from '../../shared/types'
import { mergeStats, type StatsByHash } from './torrentStats'

/**
 * Swarm numbers per loaded torrent, which the main process sends every second. Kept out of React state at the top of
 * the app: a component reads the one torrent it shows and re-renders only when that torrent's numbers change.
 */

let current: StatsByHash = {}
const listeners = new Set<() => void>()
let stopListening: (() => void) | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  stopListening ??= window.chomusuke.onStats(list => {
    current = mergeStats(current, list)
    for (const notify of listeners) notify()
  })
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopListening?.()
      stopListening = null
    }
  }
}

/** One torrent's swarm numbers, while it's loaded. */
export function useTorrentStats(infoHash: string | null | undefined): TorrentStats | undefined {
  return useSyncExternalStore(subscribe, () => (infoHash ? current[infoHash] : undefined))
}
