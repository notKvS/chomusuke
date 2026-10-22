import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRange } from './range.ts'

test('no header means the whole file', () => {
  assert.equal(parseRange(undefined, 100), null)
})

test('open-ended range', () => {
  assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 })
})

test('closed range is clamped to the file size', () => {
  assert.deepEqual(parseRange('bytes=0-0', 100), { start: 0, end: 0 })
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
})

test('suffix range', () => {
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 })
})

test('unsatisfiable ranges', () => {
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable')
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable')
})

test('malformed or multi-part ranges are ignored', () => {
  assert.equal(parseRange('bytes=5-2', 100), null)
  assert.equal(parseRange('bytes=0-1,5-6', 100), null)
  assert.equal(parseRange('items=0-1', 100), null)
  assert.equal(parseRange('bytes=-', 100), null)
  assert.equal(parseRange('bytes=abc-', 100), null)
})
