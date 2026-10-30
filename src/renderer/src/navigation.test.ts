import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type History,
  historyReducer,
  INITIAL_HISTORY,
  MAX_HISTORY,
  type Page,
  samePage,
  sidebarKey
} from './navigation.ts'

const push = (h: History, page: Page) => historyReducer(h, { type: 'push', page })
const album = (infoHash: string): Page => ({ kind: 'album', infoHash })

test('samePage compares each kind by what identifies it', () => {
  assert.ok(samePage({ kind: 'home' }, { kind: 'home' }))
  assert.ok(samePage(album('a'), album('a')))
  assert.ok(!samePage(album('a'), album('b')))
  assert.ok(samePage({ kind: 'search', query: 'x' }, { kind: 'search', query: 'x' }))
  assert.ok(!samePage({ kind: 'search', query: 'x' }, { kind: 'search', query: 'y' }))
  assert.ok(!samePage({ kind: 'playlist', id: '1' }, { kind: 'playlist', id: '2' }))
  assert.ok(!samePage({ kind: 'settings', section: 'sources' }, { kind: 'settings', section: 'backup' }))
  assert.ok(!samePage({ kind: 'home' }, { kind: 'explore' }))
})

test('pushing the page already shown changes nothing', () => {
  const h = push(INITIAL_HISTORY, album('a'))
  assert.equal(push(h, album('a')), h)
  assert.equal(push(INITIAL_HISTORY, { kind: 'home' }), INITIAL_HISTORY)
})

test('pushing after going back drops the forward pages', () => {
  let h = push(push(INITIAL_HISTORY, album('a')), album('b'))
  h = historyReducer(h, { type: 'back' })
  assert.deepEqual(h.pages[h.index], album('a'))
  h = push(h, { kind: 'explore' })
  assert.deepEqual(h.pages, [{ kind: 'home' }, album('a'), { kind: 'explore' }])
  assert.equal(h.index, 2)
})

test('history keeps only the most recent pages', () => {
  let h = INITIAL_HISTORY
  for (let i = 0; i < MAX_HISTORY + 10; i++) h = push(h, album(String(i)))
  assert.equal(h.pages.length, MAX_HISTORY)
  assert.equal(h.index, MAX_HISTORY - 1)
  assert.deepEqual(h.pages.at(-1), album(String(MAX_HISTORY + 9)))
  assert.deepEqual(h.pages[0], album('10'))
})

test('back and forward stop at the ends', () => {
  assert.equal(historyReducer(INITIAL_HISTORY, { type: 'back' }), INITIAL_HISTORY)
  assert.equal(historyReducer(INITIAL_HISTORY, { type: 'forward' }), INITIAL_HISTORY)
  let h = push(INITIAL_HISTORY, album('a'))
  assert.equal(historyReducer(h, { type: 'forward' }), h)
  h = historyReducer(h, { type: 'back' })
  assert.equal(h.index, 0)
  h = historyReducer(h, { type: 'forward' })
  assert.equal(h.index, 1)
})

test('sidebarKey names the entry to highlight', () => {
  assert.equal(sidebarKey(album('abc')), 'abc')
  assert.equal(sidebarKey({ kind: 'playlist', id: '7' }), 'playlist:7')
  assert.equal(sidebarKey({ kind: 'liked' }), 'liked')
  assert.equal(sidebarKey({ kind: 'loading' }), '')
  assert.equal(sidebarKey({ kind: 'error', message: 'nope' }), '')
})
