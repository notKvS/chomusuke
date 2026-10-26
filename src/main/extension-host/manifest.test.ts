import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExtensionError, hostAllowed, parseRepository, sanitizeResults } from './manifest.ts'

const REPO = 'https://example.github.io/chomusuke-ext/index.json'
const valid = {
  manifestVersion: 1,
  id: 'live-music',
  name: 'Live Music',
  version: '1.0.0',
  type: 'torrent',
  code: 'live.js',
  hosts: ['archive.org', '*.archive.org'],
  layout: 'cards',
  categories: [
    { id: 'week', name: 'This week' },
    { id: '../bad', name: 'x' }
  ],
  options: {
    apiKey: { type: 'string', label: 'API key', secret: true, default: 'leak' },
    lossless: { type: 'boolean', label: 'Lossless only', default: true },
    'bad key': { type: 'string' }
  }
}

test('parses and normalises a repository', () => {
  const [manifest] = parseRepository([valid], REPO)
  assert.equal(manifest.codeUrl, 'https://example.github.io/chomusuke-ext/live.js')
  assert.deepEqual(manifest.categories, [{ id: 'week', name: 'This week' }])
  assert.deepEqual(Object.keys(manifest.options), ['apiKey', 'lossless'])
  assert.equal(manifest.options.apiKey.secret, true)
  assert.equal(manifest.options.apiKey.default, undefined)
  assert.equal(manifest.layout, 'cards')
  assert.deepEqual(parseRepository({ extensions: [valid] }, REPO).length, 1)
})

test('rejects unsafe or malformed manifests', () => {
  const bad = (patch: Record<string, unknown>) => () => parseRepository([{ ...valid, ...patch }], REPO)
  assert.throws(bad({ code: 'http://evil.example/x.js' }), ExtensionError)
  assert.throws(bad({ hosts: [] }), /hosts/)
  assert.throws(bad({ hosts: ['*'] }), /hosts/)
  assert.throws(bad({ hosts: ['192.168.1.1'] }), /hosts/)
  assert.throws(bad({ id: 'Bad Id' }), /id/)
  assert.throws(bad({ type: 'nzb' }), /torrent/)
  assert.throws(bad({ manifestVersion: 2 }), /version/)
  assert.throws(() => parseRepository([valid, valid], REPO), /twice/)
  assert.throws(() => parseRepository({}, REPO), ExtensionError)
})

test('http code is only allowed on a private repository origin', () => {
  const local = 'http://127.0.0.1:8080/repo/index.json'
  assert.throws(() => parseRepository([valid], local), /https/)
  assert.equal(parseRepository([valid], local, true)[0].codeUrl, 'http://127.0.0.1:8080/repo/live.js')
  assert.throws(() => parseRepository([{ ...valid, code: 'http://127.0.0.1:9999/x.js' }], local, true), /https/)
})

test('hostAllowed', () => {
  const hosts = ['archive.org', '*.archive.org']
  assert.equal(hostAllowed('archive.org', hosts), true)
  assert.equal(hostAllowed('ia800.us.archive.org', hosts), true)
  assert.equal(hostAllowed('evilarchive.org', hosts), false)
  assert.equal(hostAllowed('archive.org.evil.com', hosts), false)
})

test('sanitizeResults keeps only well-formed, allowed results', () => {
  const [manifest] = parseRepository([valid], REPO)
  const albums = sanitizeResults(
    [
      {
        title: 'Good',
        link: 'https://archive.org/download/x/x_archive.torrent',
        seeders: 5,
        tags: ['FLAC', 7, ''],
        artwork: 'https://archive.org/services/img/x'
      },
      { title: 'Magnet', link: `magnet:?xt=urn:btih:${'a'.repeat(40)}` },
      { title: 'Hash only', hash: 'B'.repeat(40), size: -4 },
      { title: 'Other host', link: 'https://evil.example/x.torrent' },
      { title: 'File', link: 'file:///C:/Windows/win.ini' },
      { title: 'Plain http', link: 'http://archive.org/x.torrent', artwork: 'http://archive.org/img' },
      { link: `magnet:?xt=urn:btih:${'a'.repeat(40)}` },
      'junk'
    ],
    manifest
  )
  assert.deepEqual(
    albums.map(a => [a.title, a.seeders, a.size, a.tags, a.artwork !== undefined]),
    [
      ['Good', 5, undefined, ['FLAC', '7'], true],
      ['Magnet', undefined, undefined, undefined, false],
      ['Hash only', undefined, undefined, undefined, false]
    ]
  )
  assert.throws(() => sanitizeResults({ not: 'an array' }, manifest), ExtensionError)
})
