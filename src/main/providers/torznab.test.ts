import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTorznabProvider, isPrivateHost, parseTorznab, testTorznab, TorznabError } from './torznab.ts'

const HASH = 'c9e15763f722f23e98a29decdfae341b98d53056'
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Album&tr=udp%3A%2F%2Ftracker.example%3A1337`

const feed = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>${items}</channel>
</rss>`

const item = (title: string, attrs: Record<string, string>, extra = '') => `
  <item>
    <title>${title}</title>
    ${extra}
    ${Object.entries(attrs)
      .map(([name, value]) => `<torznab:attr name="${name}" value="${value}" />`)
      .join('\n')}
  </item>`

let server: http.Server
let base = ''
const requests: URL[] = []

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    requests.push(url)
    if (url.pathname === '/api' && url.searchParams.get('apikey') !== 'secret-key') {
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      return res.end('<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>')
    }
    if (url.pathname === '/api' && url.searchParams.get('t') === 'caps') {
      return res.end('<?xml version="1.0"?><caps><server title="Fake"/></caps>')
    }
    if (url.pathname === '/api') {
      return res.end(
        feed(
          item('Some Band - Low Seeds (2001) [MP3 320]', { seeders: '3', magneturl: MAGNET, category: '3010' }) +
            item('Some Band - Great Album (1999) [FLAC 24bit]', { seeders: '120', peers: '140', size: '734003200', category: '3040' }, `<link>${base}/dl/1</link>`) +
            item('A Movie (2020) 1080p', { seeders: '999', infohash: HASH, category: '2040' }) +
            item('Magnet via redirect &amp; friends', { seeders: '10' }, `<enclosure url="${base}/dl/2" length="1" type="application/x-bittorrent" />`) +
            item('No way to download', { seeders: '50' })
        )
      )
    }
    if (url.pathname === '/dl/1') {
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent' })
      return res.end(Buffer.from('d4:infod4:name1:xee'))
    }
    if (url.pathname === '/dl/2') {
      res.writeHead(302, { Location: MAGNET })
      return res.end()
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => new Promise<void>(resolve => server.close(() => resolve())))

const config = () => ({ id: 'jackett', name: 'Jackett', url: `${base}/api`, apiKey: 'secret-key' })

test('search asks for audio, drops non-audio and undownloadable items, sorts by seeders', async () => {
  const provider = createTorznabProvider(config())
  const results = await provider.search('some band', new AbortController().signal)
  const sent = requests.at(-1)!
  assert.equal(sent.searchParams.get('t'), 'search')
  assert.equal(sent.searchParams.get('q'), 'some band')
  assert.equal(sent.searchParams.get('cat'), '3000')
  assert.deepEqual(
    results.albums.map(a => [a.title, a.seeders, a.year, a.tags]),
    [
      ['Some Band - Great Album (1999) [FLAC 24bit]', 120, '1999', ['FLAC', '24BIT']],
      ['Magnet via redirect & friends', 10, undefined, []],
      ['Some Band - Low Seeds (2001) [MP3 320]', 3, '2001', ['MP3', '320']]
    ]
  )
  assert.equal(results.albums[0].size, 734003200)
  assert.deepEqual(results.songs, [])
})

test('open resolves magnets, downloads .torrent links and follows magnet redirects', async () => {
  const provider = createTorznabProvider(config())
  const { albums } = await provider.search('some band', new AbortController().signal)
  const [linked, redirected, magnet] = albums
  const linkedPlayable = await provider.open(linked)
  assert.ok(linkedPlayable.torrent instanceof Uint8Array)
  assert.equal(Buffer.from(linkedPlayable.torrent).toString(), 'd4:infod4:name1:xee')
  assert.equal((await provider.open(redirected)).torrent, MAGNET)
  assert.equal((await provider.open(magnet)).torrent, MAGNET)
})

test('indexer errors surface as safe messages without the key', async () => {
  const provider = createTorznabProvider({ ...config(), apiKey: 'wrong' })
  await assert.rejects(provider.search('x', new AbortController().signal), (err: Error) => {
    assert.ok(err instanceof TorznabError)
    assert.match(err.message, /Incorrect user credentials/)
    assert.doesNotMatch(err.message, /wrong|apikey/)
    return true
  })
})

test('plain http is refused for public hosts', async () => {
  const provider = createTorznabProvider({ ...config(), url: 'http://indexer.example.com/api' })
  await assert.rejects(provider.search('x', new AbortController().signal), /must use https/)
})

test('testTorznab checks capabilities', async () => {
  assert.equal(await testTorznab(config()), 'Connected to Jackett.')
  await assert.rejects(testTorznab({ ...config(), apiKey: 'nope' }), /Incorrect user credentials/)
})

test('parseTorznab rejects DTDs and non-feeds', () => {
  assert.throws(() => parseTorznab('<!DOCTYPE x [<!ENTITY a "aaaa">]><rss/>'), TorznabError)
  assert.throws(() => parseTorznab('<html><body>login</body></html>'), /Torznab feed/)
  assert.deepEqual(parseTorznab(feed('')), [])
})

test('isPrivateHost', () => {
  for (const host of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.1.1', '[::1]', 'nas', 'jackett.local', 'box.home.arpa']) {
    assert.equal(isPrivateHost(host), true, host)
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', 'tracker.io']) {
    assert.equal(isPrivateHost(host), false, host)
  }
})
