import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TorrentStats } from '../../shared/types.ts'
import { mergeStats } from './torrentStats.ts'

const stats = (infoHash: string, numPeers: number, downloadSpeed = 0): TorrentStats => ({
  infoHash,
  numPeers,
  downloadSpeed,
  uploadSpeed: 0,
  uploaded: 0
})

test('torrents whose numbers did not change keep the same object, so their readers do not re-render', () => {
  const first = mergeStats({}, [stats('a', 3), stats('b', 1, 500)])
  const second = mergeStats(first, [stats('a', 3), stats('b', 2, 500)])
  assert.equal(second.a, first.a)
  assert.notEqual(second.b, first.b)
  assert.equal(second.b.numPeers, 2)
  // A torrent that's gone is dropped.
  assert.deepEqual(Object.keys(mergeStats(second, [stats('b', 2, 500)])), ['b'])
})
