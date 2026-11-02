import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  forKind,
  hostAllowed,
  missingRequired,
  PluginError,
  parseRepository,
  sanitizeChartEntries,
  sanitizeResults
} from './manifest.ts'

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
  assert.deepEqual(parseRepository({ plugins: [valid] }, REPO).length, 1)
})

test('rejects unsafe or malformed manifests', () => {
  const bad = (patch: Record<string, unknown>) => () => parseRepository([{ ...valid, ...patch }], REPO)
  assert.throws(bad({ code: 'http://evil.example/x.js' }), PluginError)
  assert.throws(bad({ hosts: [] }), /hosts/)
  assert.throws(bad({ hosts: ['*'] }), /hosts/)
  assert.throws(bad({ hosts: ['192.168.1.1'] }), /hosts/)
  assert.throws(bad({ id: 'Bad Id' }), /id/)
  assert.throws(bad({ type: 'nzb' }), /torrent/)
  assert.throws(bad({ manifestVersion: 2 }), /version/)
  assert.throws(() => parseRepository([valid, valid], REPO), /twice/)
  assert.throws(() => parseRepository({}, REPO), PluginError)
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

test('chart manifests are browse-only cards and need categories', () => {
  const chart = { ...valid, type: 'chart', layout: 'list' }
  const [manifest] = parseRepository([chart], REPO)
  assert.equal(manifest.type, 'chart')
  assert.equal(manifest.layout, 'cards')
  assert.equal(parseRepository([valid], REPO)[0].type, 'torrent')
  assert.throws(() => parseRepository([{ ...chart, categories: [] }], REPO), /categories/)
})

test('sanitizeChartEntries keeps entries with a title and an artist, once each', () => {
  const [manifest] = parseRepository([{ ...valid, type: 'chart' }], REPO)
  const entries = sanitizeChartEntries(
    [
      {
        kind: 'song',
        title: 'Espresso',
        artist: 'Sabrina Carpenter',
        album: 'Short n’ Sweet',
        artwork: 'https://x/y.jpg'
      },
      { kind: 'song', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet' },
      { kind: 'weird', title: 'Mayhem', artist: 'Lady Gaga', album: 'ignored', link: 'magnet:?xt=urn:btih:x' },
      { title: 'No artist' },
      { artist: 'No title' },
      'junk'
    ],
    manifest
  )
  assert.deepEqual(
    entries.map(e => [e.title, e.artist, e.chart, e.artwork !== undefined, JSON.parse(e.ref)]),
    [
      [
        'Espresso',
        'Sabrina Carpenter',
        'song',
        true,
        { kind: 'song', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet' }
      ],
      ['Mayhem', 'Lady Gaga', 'album', false, { kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' }]
    ]
  )
  assert.throws(() => sanitizeChartEntries({ not: 'an array' }, manifest), PluginError)
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
  assert.throws(() => sanitizeResults({ not: 'an array' }, manifest), PluginError)
})

test('a repository is split by kind, and one with only the other kind points to its tab', () => {
  const entry = (id: string, type: 'torrent' | 'chart') => ({
    manifest: parseRepository([{ ...valid, id, type, categories: [{ id: 'top', name: 'Top' }] }], REPO)[0]
  })
  const mixed = [entry('a', 'torrent'), entry('b', 'chart'), entry('c', 'torrent')]
  assert.deepEqual(
    forKind(mixed, 'provider').map(i => i.manifest.id),
    ['a', 'c']
  )
  assert.deepEqual(
    forKind(mixed, 'chart').map(i => i.manifest.id),
    ['b']
  )
  assert.throws(() => forKind([entry('b', 'chart')], 'provider'), /Settings → Charts/)
  assert.throws(() => forKind([entry('a', 'torrent')], 'chart'), /Settings → Plugins/)
})

test('a plugin can ask for details in a setup window: required options, hints, a note, a kept login', () => {
  const [plain] = parseRepository([valid], REPO)
  assert.equal(plain.setup, undefined)
  assert.equal(plain.session, false)
  assert.equal(plain.options.lossless.required, false)

  const [asking] = parseRepository(
    [
      {
        ...valid,
        id: 'asking',
        setup: '  Sign in with\nyour account.  ',
        session: true,
        options: {
          username: { type: 'string', label: 'Username', required: true, placeholder: 'Your name' },
          password: { type: 'string', label: 'Password', secret: true, required: true },
          // Only text can be required: a switch is always either on or off.
          flag: { type: 'boolean', label: 'Flag', required: true }
        }
      }
    ],
    REPO
  )
  assert.equal(asking.setup, 'Sign in with your account.')
  assert.equal(asking.session, true)
  assert.deepEqual([asking.options.username.required, asking.options.username.placeholder], [true, 'Your name'])
  assert.equal(asking.options.password.required, true)
  assert.equal(asking.options.flag.required, false)
})

test('the required options still without a value are named', () => {
  const [asking] = parseRepository(
    [
      {
        ...valid,
        options: {
          username: { type: 'string', label: 'Username', required: true },
          password: { type: 'string', label: 'Password', secret: true, required: true },
          mirror: { type: 'string', label: 'Mirror' }
        }
      }
    ],
    REPO
  )
  assert.deepEqual(missingRequired(asking, { username: '', password: '', mirror: '' }), ['Username', 'Password'])
  assert.deepEqual(missingRequired(asking, { username: '  ', password: 'x', mirror: '' }), ['Username'])
  assert.deepEqual(missingRequired(asking, { username: 'me', password: 'x' }), [])
  assert.deepEqual(missingRequired(asking, {}), ['Username', 'Password'])
})
