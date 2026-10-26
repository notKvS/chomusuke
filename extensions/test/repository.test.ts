// The bundled repository must pass the app's own manifest validation, and every entry needs its source file.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { parseRepository } from '../../src/main/extensions/manifest.ts'
import { MIRRORS as X1337X_MIRRORS } from '../src/1337x.ts'
import { MIRRORS as LIME_MIRRORS } from '../src/limetorrents.ts'

const root = path.join(import.meta.dirname, '..')
const raw = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'))
const manifests = parseRepository(raw, 'https://bundled.chomusuke.invalid/extensions/index.json')
const TEMPLATES = ['the-pirate-bay', '1337x', 'nyaa', 'knaben', 'limetorrents']

test('bundled manifests are valid and have sources', () => {
  for (const manifest of manifests) {
    const file = new URL(manifest.codeUrl).pathname.split('/').pop()!.replace(/\.js$/, '.ts')
    assert.ok(existsSync(path.join(root, 'src', file)), `${manifest.id}: missing extensions/src/${file}`)
  }
})

test('tracker templates install switched off; the Internet Archive collections stay on', () => {
  for (const manifest of manifests)
    assert.equal(manifest.enabledByDefault, !TEMPLATES.includes(manifest.id), manifest.id)
})

test('mirror lists in code match the hosts the sandbox allows', () => {
  const hosts = (id: string) => manifests.find(m => m.id === id)!.hosts
  assert.deepEqual(hosts('1337x'), X1337X_MIRRORS)
  assert.deepEqual(hosts('limetorrents'), LIME_MIRRORS)
})
