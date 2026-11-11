import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type CrashKind, crashDetail, isCrash } from './crash-info.ts'

test('a window that closed normally is not a crash; every other reason is', () => {
  assert.equal(isCrash('clean-exit'), false)
  for (const reason of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure']) {
    assert.equal(isCrash(reason), true, reason)
  }
})

test('the dialog says what happened and what sharing does, for each kind of crash', () => {
  const kinds: CrashKind[] = ['main-error', 'window-gone', 'window-error']
  const texts = kinds.map(crashDetail)
  assert.equal(new Set(texts).size, 3)
  for (const text of texts) {
    assert.match(text, /Share with developer/)
    assert.match(text, /never passwords or API keys/)
  }
})
