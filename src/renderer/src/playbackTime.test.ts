import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlaybackClock } from './playbackTime.ts'

test('the playback clock tells listeners about changes only, and stops when they unsubscribe', () => {
  const clock = createPlaybackClock()
  let calls = 0
  const unsubscribe = clock.subscribe(() => calls++)

  clock.set({ currentTime: 1.5, bufferedEnd: 10 })
  const first = clock.get()
  clock.set({ currentTime: 1.5, bufferedEnd: 10 })
  // The same time again: no re-render, and the same snapshot (useSyncExternalStore compares by reference).
  assert.equal(calls, 1)
  assert.equal(clock.get(), first)

  clock.set({ currentTime: 1.5, bufferedEnd: 12 })
  assert.equal(calls, 2)
  assert.deepEqual(clock.get(), { currentTime: 1.5, bufferedEnd: 12 })

  unsubscribe()
  clock.set({ currentTime: 3, bufferedEnd: 12 })
  assert.equal(calls, 2)
})
