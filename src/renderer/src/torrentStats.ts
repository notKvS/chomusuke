import type { TorrentStats } from '../../shared/types'

// Swarm numbers per loaded torrent, as the main process sends them every second (see useTorrentStats).

export type StatsByHash = Readonly<Record<string, TorrentStats>>

const sameStats = (a: TorrentStats, b: TorrentStats): boolean =>
  a.numPeers === b.numPeers &&
  a.downloadSpeed === b.downloadSpeed &&
  a.uploadSpeed === b.uploadSpeed &&
  a.uploaded === b.uploaded

/** The new numbers, reusing the old object for each torrent whose numbers are the same. */
export function mergeStats(previous: StatsByHash, list: TorrentStats[]): StatsByHash {
  const next: Record<string, TorrentStats> = {}
  for (const stats of list) {
    const before = previous[stats.infoHash]
    next[stats.infoHash] = before && sameStats(before, stats) ? before : stats
  }
  return next
}
