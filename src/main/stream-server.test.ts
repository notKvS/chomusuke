import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { startStreamServer, type StreamServer } from './stream-server.ts'

const HASH = 'a'.repeat(40)
const DATA = Buffer.from('0123456789abcdefghij')

let server: StreamServer

before(async () => {
  server = await startStreamServer((infoHash, fileIndex) => {
    if (infoHash !== HASH || fileIndex !== 3) return undefined
    return {
      length: DATA.length,
      mime: 'audio/mpeg',
      // Deliberately ignores `end`, like a torrent stream can — the server must cap it.
      createReadStream: start => Readable.from([DATA.subarray(start, start + 4), DATA.subarray(start + 4)])
    }
  })
})

after(() => server.close())

test('serves the whole file', async () => {
  const res = await fetch(`${server.baseUrl}/${HASH}/3`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/mpeg')
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(await res.text(), DATA.toString())
})

test('serves byte ranges with 206', async () => {
  const res = await fetch(`${server.baseUrl}/${HASH}/3`, { headers: { Range: 'bytes=2-6' } })
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('content-range'), `bytes 2-6/${DATA.length}`)
  assert.equal(await res.text(), '23456')
})

test('answers 416 for ranges past the end', async () => {
  const res = await fetch(`${server.baseUrl}/${HASH}/3`, { headers: { Range: 'bytes=999-' } })
  assert.equal(res.status, 416)
  assert.equal(res.headers.get('content-range'), `bytes */${DATA.length}`)
})

test('rejects a wrong token', async () => {
  const wrong = server.baseUrl.replace(/[a-f0-9]{64}$/, 'b'.repeat(64))
  const res = await fetch(`${wrong}/${HASH}/3`)
  assert.equal(res.status, 404)
})

test('rejects unknown files and malformed paths', async () => {
  assert.equal((await fetch(`${server.baseUrl}/${HASH}/4`)).status, 404)
  assert.equal((await fetch(`${server.baseUrl}/${HASH}/../../etc`)).status, 404)
  assert.equal((await fetch(`${server.baseUrl}/${HASH}/3`, { method: 'POST' })).status, 405)
})

test('rejects requests for a different Host (DNS rebinding)', async () => {
  const url = new URL(`${server.baseUrl}/${HASH}/3`)
  const status = await new Promise<number>((resolve, reject) => {
    import('node:http').then(http =>
      http
        .get({ host: '127.0.0.1', port: url.port, path: url.pathname, headers: { Host: `evil.example:${url.port}` } }, res => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        .on('error', reject)
    )
  })
  assert.equal(status, 403)
})
