import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readJsonFile, writeJsonFile } from './json-file.ts'

async function withDir(run: (file: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-json-'))
  try {
    await run(path.join(dir, 'store.json'), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a missing file is a first run, not damage', () =>
  withDir(async file => {
    assert.deepEqual(await readJsonFile(file), undefined)
  }))

test('writing keeps the previous version as the last good copy', () =>
  withDir(async file => {
    await writeJsonFile(file, JSON.stringify({ n: 1 }))
    await writeJsonFile(file, JSON.stringify({ n: 2 }))
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 2 })
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { n: 1 })
    assert.deepEqual(await readJsonFile(file), { n: 2 })
  }))

test('a damaged file is set aside and the last good copy is used', () =>
  withDir(async (file, dir) => {
    await writeJsonFile(file, JSON.stringify({ n: 1 }))
    await writeJsonFile(file, JSON.stringify({ n: 2 }))
    await writeFile(file, '{"n": 3, trunc')
    assert.deepEqual(await readJsonFile(file), { n: 1 })
    // The damaged file is kept for the user, not overwritten.
    const aside = (await readdir(dir)).filter(name => name.startsWith('store.json.corrupt-'))
    assert.equal(aside.length, 1)
    assert.equal(await readFile(path.join(dir, aside[0]), 'utf8'), '{"n": 3, trunc')
    // Until something is saved again, the next start still finds the last good copy.
    assert.deepEqual(await readJsonFile(file), { n: 1 })
  }))

test('JSON that is not an object counts as damaged; with no good copy there is no data', () =>
  withDir(async file => {
    await writeFile(file, '[1, 2]')
    assert.deepEqual(await readJsonFile(file), undefined)
  }))
