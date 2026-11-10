import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { HttpSource } from './http-source.ts'
import type { HttpPlayable } from './providers/types.ts'
import { SourceError } from './source.ts'
import { startStreamServer } from './stream-server.ts'

const ID = 'b'.repeat(40)
const DATA = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

let upstream: http.Server
let base = ''
const seen: Array<{ url: string; range?: string; referer?: string; cookie?: string }> = []

before(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({
      url: req.url ?? '',
      range: req.headers.range,
      referer: req.headers.referer,
      cookie: req.headers.cookie
    })
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/song.mp3' }).end()
      return
    }
    if (req.url === '/gone.mp3') {
      res.writeHead(403).end()
      return
    }
    if (req.url === '/cover.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 4 }).end(Buffer.from([1, 2, 3, 4]))
      return
    }
    if (req.url === '/page.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 4 }).end('<b/>')
      return
    }
    const rangeable = req.url === '/song.mp3'
    const match = rangeable ? /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '') : null
    if (match) {
      const [start, end] = [Number(match[1]), Math.min(Number(match[2]), DATA.length - 1)]
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${DATA.length}`,
        'Content-Length': end - start + 1
      })
      res.end(DATA.subarray(start, end + 1))
      return
    }
    // No Range support: the whole file, whatever was asked.
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': DATA.length })
    res.end(DATA)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})

after(() => {
  upstream.closeAllConnections()
  upstream.close()
})

const playable = (urls: string[], headers?: Record<string, string>): HttpPlayable => ({
  kind: 'http',
  id: ID,
  origin: { provider: 'plugin-demo', id: 'song-1' },
  title: 'An album',
  artist: 'An artist',
  tracks: urls.map((url, i) => ({ title: `Song ${i + 1}`, url, headers }))
})

const bytes = async (stream: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const source = () => new HttpSource('http://127.0.0.1:1/media/token', { allowPrivate: true })

test('load builds an album whose tracks point at the stream server', () => {
  const album = source().load(playable([`${base}/song.mp3`, `${base}/other.flac`]))
  assert.equal(album.infoHash, ID)
  assert.equal(album.source, 'http')
  assert.equal(album.artist, 'An artist')
  assert.deepEqual(
    album.tracks.map(t => [t.id, t.url, t.title, t.trackNo, t.format]),
    [
      [`${ID}:0`, `http://127.0.0.1:1/media/token/${ID}/0`, 'Song 1', 1, 'MP3'],
      [`${ID}:1`, `http://127.0.0.1:1/media/token/${ID}/1`, 'Song 2', 2, 'FLAC']
    ]
  )
  assert.throws(() => source().load({ ...playable([]) }), SourceError)
})

test('the cover is served through the stream server as one more file', async () => {
  const http = source()
  const album = http.load({ ...playable([`${base}/song.mp3`]), coverUrl: `${base}/cover.png` })
  assert.equal(album.coverUrl, `http://127.0.0.1:1/media/token/${ID}/1`)
  assert.equal(album.tracks.length, 1)
  const cover = await http.resolveFile(ID, 1)
  assert.equal(cover?.mime, 'image/png')
  assert.deepEqual(await bytes(cover?.createReadStream(0, 3) ?? []), Buffer.from([1, 2, 3, 4]))
})

test('a server can’t make us pass on html as audio', async () => {
  const http = source()
  http.load(playable([`${base}/page.html`]))
  assert.equal((await http.resolveFile(ID, 0))?.mime, 'audio/mpeg')
})

test('serves byte ranges from an upstream that supports Range', async () => {
  const http = source()
  http.load(playable([`${base}/song.mp3`]))
  const file = await http.resolveFile(ID, 0)
  assert.ok(file)
  assert.equal(file.length, DATA.length)
  // application/octet-stream says nothing: the extension decides.
  assert.equal(file.mime, 'audio/mpeg')
  assert.deepEqual(await bytes(file.createReadStream(10, 19)), DATA.subarray(10, 20))
  assert.deepEqual(await bytes(file.createReadStream(990, 999)), DATA.subarray(990, 1000))
  assert.equal(seen.at(-1)?.range, 'bytes=990-999')
})

test('skips ahead itself when the upstream ignores Range', async () => {
  const http = source()
  http.load(playable([`${base}/plain.mp3`]))
  const file = await http.resolveFile(ID, 0)
  assert.ok(file)
  assert.equal(file.length, DATA.length)
  assert.equal(file.mime, 'audio/mpeg')
  assert.deepEqual(await bytes(file.createReadStream(300, 309)), DATA.subarray(300, 310))
})

test('follows redirects and sends only declared headers, without cookies leaving the host', async () => {
  const http = source()
  http.load(playable([`${base}/redirect`], { Referer: 'https://example.org/', Cookie: 'a=b' }))
  const file = await http.resolveFile(ID, 0)
  assert.equal(file?.length, DATA.length)
  const last = seen.at(-1)
  assert.equal(last?.url, '/song.mp3')
  assert.equal(last?.referer, 'https://example.org/')
  assert.equal(last?.cookie, 'a=b') // same origin: kept
})

test('an upstream error fails the lookup with a message for the user', async () => {
  const http = source()
  http.load(playable([`${base}/gone.mp3`]))
  await assert.rejects(http.resolveFile(ID, 0), (err: Error) => err instanceof SourceError && /403/.test(err.message))
})

test('unknown albums and tracks resolve to nothing', async () => {
  const http = source()
  http.load(playable([`${base}/song.mp3`]))
  assert.equal(await http.resolveFile(ID, 5), undefined)
  assert.equal(await http.resolveFile('c'.repeat(40), 0), undefined)
})

test('refuses plain http and private addresses unless told otherwise', async () => {
  const strict = new HttpSource('http://127.0.0.1:1/media/token')
  strict.load(playable([`${base}/song.mp3`]))
  await assert.rejects(strict.resolveFile(ID, 0), SourceError)
  strict.load({ ...playable(['https://localhost/song.mp3']) })
  await assert.rejects(strict.resolveFile(ID, 0), (err: Error) => /private/.test(err.message))
})

test('plays through the stream server like any other file', async () => {
  let httpSource: HttpSource | undefined
  const server = await startStreamServer((hash, index) => httpSource?.resolveFile(hash, index))
  try {
    httpSource = new HttpSource(server.baseUrl, { allowPrivate: true })
    const album = httpSource.load(playable([`${base}/song.mp3`]))
    const res = await fetch(album.tracks[0].url, { headers: { Range: 'bytes=100-199' } })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), `bytes 100-199/${DATA.length}`)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), DATA.subarray(100, 200))

    // A track the upstream refuses is a 502, not a hung request.
    const broken = httpSource.load({ ...playable([`${base}/gone.mp3`]), id: 'd'.repeat(40) })
    assert.equal((await fetch(broken.tracks[0].url)).status, 502)
  } finally {
    await server.close()
  }
})

test('songInfo says what is needed to rate a track and find it again', () => {
  const http = source()
  const album = http.load({ ...playable([`${base}/song.mp3`]), origin: { provider: 'plugin-demo', id: 'abc123' } })
  assert.deepEqual(http.songInfo(ID, album.tracks[0].key), {
    infoHash: ID,
    key: album.tracks[0].key,
    title: 'Song 1',
    artist: 'An artist',
    album: 'An album',
    duration: undefined,
    http: { provider: 'plugin-demo', id: 'abc123' }
  })
  assert.equal(http.songInfo(ID, 'nope'), undefined)
  assert.equal(http.songInfo('c'.repeat(40), album.tracks[0].key), undefined)
})
