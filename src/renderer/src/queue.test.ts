import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SongRef } from '../../shared/types.ts'
import { type Queue, queueEdges, shuffle, stepQueue } from './queue.ts'

const queueOf = (length: number, position: number): Queue => ({
  label: 'Test',
  items: Array.from({ length }, (_, i) => ({ id: String(i) }) as SongRef),
  position
})

/** A repeatable pseudo-random source (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('shuffle keeps every item exactly once and leaves the input alone', () => {
  const items = Array.from({ length: 50 }, (_, i) => i)
  for (let seed = 1; seed <= 20; seed++) {
    const shuffled = shuffle(items, seeded(seed))
    assert.equal(shuffled.length, items.length)
    assert.deepEqual(
      [...shuffled].sort((a, b) => a - b),
      items
    )
  }
  assert.deepEqual(
    items,
    Array.from({ length: 50 }, (_, i) => i)
  )
  assert.notDeepEqual(shuffle(items, seeded(1)), items)
})

test('shuffle handles empty and single lists', () => {
  assert.deepEqual(shuffle([]), [])
  assert.deepEqual(shuffle(['a']), ['a'])
})

test('shuffle with a random source near 1 or 0 stays in bounds', () => {
  assert.deepEqual([...shuffle([1, 2, 3], () => 0.999999)].sort(), [1, 2, 3])
  assert.deepEqual(
    shuffle([1, 2, 3], () => 0),
    [2, 3, 1]
  )
})

test('stepQueue moves within the queue and stops past either end', () => {
  assert.equal(stepQueue(queueOf(3, 0), 1), 1)
  assert.equal(stepQueue(queueOf(3, 1), -1), 0)
  assert.equal(stepQueue(queueOf(3, 2), 1), null)
  assert.equal(stepQueue(queueOf(3, 0), -1), null)
  assert.equal(stepQueue(queueOf(0, 0), 1), null)
  assert.equal(stepQueue(null, 1), null)
})

test('queueEdges reports where next and previous can go', () => {
  assert.deepEqual(queueEdges(queueOf(3, 0)), { hasNext: true, hasPrev: false })
  assert.deepEqual(queueEdges(queueOf(3, 1)), { hasNext: true, hasPrev: true })
  assert.deepEqual(queueEdges(queueOf(3, 2)), { hasNext: false, hasPrev: true })
  assert.deepEqual(queueEdges(queueOf(1, 0)), { hasNext: false, hasPrev: false })
})
