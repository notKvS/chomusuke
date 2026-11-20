import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enqueue, MAX_UP_NEXT, moveItem, removeItem, type UpNextItem } from './upNext.ts'

const item = (id: string): UpNextItem => ({ id, title: id, source: { kind: 'result', albumId: `archive:${id}` } })
const ids = (items: UpNextItem[]) => items.map(i => i.id)

test('"Play next" goes in front, "Add to queue" at the end, and several songs keep their order', () => {
  const queue = enqueue([item('a')], [item('b')], 'last')
  assert.deepEqual(ids(queue), ['a', 'b'])
  assert.deepEqual(ids(enqueue(queue, [item('x'), item('y')], 'next')), ['x', 'y', 'a', 'b'])
  assert.deepEqual(ids(enqueue(queue, [item('x'), item('y')], 'last')), ['a', 'b', 'x', 'y'])
})

test('a full queue refuses more songs, all or nothing', () => {
  const full = Array.from({ length: MAX_UP_NEXT - 1 }, (_, i) => item(String(i)))
  assert.equal(enqueue(full, [item('fits')], 'last').length, MAX_UP_NEXT)
  assert.equal(enqueue(full, [item('one'), item('two')], 'next').length, MAX_UP_NEXT - 1)
})

test('songs are removed by id and moved within range only', () => {
  const queue = [item('a'), item('b'), item('c')]
  assert.deepEqual(ids(removeItem(queue, 'b')), ['a', 'c'])
  assert.deepEqual(ids(moveItem(queue, 0, 2)), ['b', 'c', 'a'])
  assert.deepEqual(ids(moveItem(queue, 2, 1)), ['a', 'c', 'b'])
  assert.deepEqual(ids(moveItem(queue, 0, 3)), ['a', 'b', 'c'])
  assert.deepEqual(ids(moveItem(queue, -1, 0)), ['a', 'b', 'c'])
})
