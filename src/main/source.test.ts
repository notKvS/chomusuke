import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSource, SourceError } from './source.ts'

const HASH = 'c9e15763f722f23e98a29decdfae341b98d53056'

test('accepts magnet links with a hex info hash', () => {
  const uri = `magnet:?xt=urn:btih:${HASH}&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969`
  assert.deepEqual(parseSource(uri), { kind: 'magnet', uri })
})

test('accepts magnet links with a base32 info hash', () => {
  const uri = 'magnet:?xt=urn:btih:ZHQVOY7XEL4T5GFCTXW57LRUDOMNKMCW'
  assert.deepEqual(parseSource(uri), { kind: 'magnet', uri })
})

test('strips exact/acceptable source params from magnet links', () => {
  const uri = `magnet:?xt=urn:btih:${HASH}&xs=http%3A%2F%2Fevil.example%2Fhuge&dn=Sintel&AS=http://x&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F`
  assert.deepEqual(parseSource(uri), {
    kind: 'magnet',
    uri: `magnet:?xt=urn:btih:${HASH}&dn=Sintel&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F`
  })
})

test('turns a bare info hash into a magnet link', () => {
  assert.deepEqual(parseSource(`  ${HASH.toUpperCase()} `), {
    kind: 'magnet',
    uri: `magnet:?xt=urn:btih:${HASH}`
  })
})

test('rejects magnet links without a valid btih', () => {
  assert.throws(() => parseSource('magnet:?dn=nothing'), SourceError)
  assert.throws(() => parseSource('magnet:?xt=urn:btih:nothex'), SourceError)
})

test('accepts https torrent URLs', () => {
  const url = 'https://archive.org/download/x/x_archive.torrent'
  assert.deepEqual(parseSource(url), { kind: 'url', url })
})

test('rejects non-https URLs and other schemes', () => {
  for (const bad of [
    'http://example.com/a.torrent',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'ftp://example.com/a.torrent'
  ]) {
    assert.throws(() => parseSource(bad), SourceError, bad)
  }
})

test('rejects URLs with embedded credentials', () => {
  assert.throws(() => parseSource('https://user:pass@example.com/a.torrent'), SourceError)
})

test('rejects empty, non-string and oversized input', () => {
  assert.throws(() => parseSource(''), SourceError)
  assert.throws(() => parseSource(42), SourceError)
  assert.throws(() => parseSource(`magnet:?xt=urn:btih:${HASH}&dn=${'a'.repeat(9000)}`), SourceError)
})
