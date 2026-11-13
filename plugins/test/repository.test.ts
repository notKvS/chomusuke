// The bundled repository must pass the app's own manifest validation, and every entry needs its source file.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { parseRepository } from '../../src/main/plugin-host/manifest.ts'
import { MIRRORS as X1337X_MIRRORS } from '../src/1337x.ts'
import { MIRRORS as BITSEARCH_MIRRORS } from '../src/bitsearch.ts'
import { MIRRORS as BTETREE_MIRRORS } from '../src/bt-etree.ts'
import { MIRRORS as GLOTORRENTS_MIRRORS } from '../src/glotorrents.ts'
import { MIRRORS as LIME_MIRRORS } from '../src/limetorrents.ts'
import { MIRRORS as RUTOR_MIRRORS } from '../src/rutor.ts'
import { MIRRORS as RUTRACKER_MIRRORS } from '../src/rutracker.ts'
import { MIRRORS as TORRENTDOWNLOAD_MIRRORS } from '../src/torrentdownload.ts'
import { MIRRORS as TORRENTDOWNLOADS_MIRRORS } from '../src/torrentdownloads.ts'
import { MIRRORS as TORRENTGALAXY_MIRRORS } from '../src/torrentgalaxy.ts'

const root = path.join(import.meta.dirname, '..')
const raw = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'))
const manifests = parseRepository(raw, 'https://bundled.chomusuke.invalid/plugins/index.json')
const TEMPLATES = [
  'the-pirate-bay',
  '1337x',
  'nyaa',
  'knaben',
  'limetorrents',
  'rutracker',
  'rutor',
  'bitsearch',
  'glotorrents',
  'torrentdownload',
  'torrentdownloads',
  'torrentgalaxy',
  'bt-etree'
]

test('bundled manifests are valid and have sources', () => {
  for (const manifest of manifests) {
    const file = new URL(manifest.codeUrl).pathname.split('/').pop()!.replace(/\.js$/, '.ts')
    assert.ok(existsSync(path.join(root, 'src', file)), `${manifest.id}: missing plugins/src/${file}`)
  }
})

test('tracker templates install switched off; the Internet Archive collections and charts stay on', () => {
  for (const manifest of manifests)
    assert.equal(manifest.enabledByDefault, !TEMPLATES.includes(manifest.id), manifest.id)
})

test('mirror lists in code match the hosts the sandbox allows', () => {
  const hosts = (id: string) => manifests.find(m => m.id === id)!.hosts
  assert.deepEqual(hosts('1337x'), X1337X_MIRRORS)
  assert.deepEqual(hosts('limetorrents'), LIME_MIRRORS)
  assert.deepEqual(hosts('rutracker'), RUTRACKER_MIRRORS)
  assert.deepEqual(hosts('rutor'), RUTOR_MIRRORS)
  assert.deepEqual(hosts('bitsearch'), BITSEARCH_MIRRORS)
  assert.deepEqual(hosts('glotorrents'), GLOTORRENTS_MIRRORS)
  assert.deepEqual(hosts('torrentdownload'), TORRENTDOWNLOAD_MIRRORS)
  assert.deepEqual(hosts('torrentdownloads'), TORRENTDOWNLOADS_MIRRORS)
  assert.deepEqual(hosts('torrentgalaxy'), TORRENTGALAXY_MIRRORS)
  assert.deepEqual(hosts('bt-etree'), BTETREE_MIRRORS)
})
