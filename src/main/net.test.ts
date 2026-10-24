import { test } from 'node:test'
import assert from 'node:assert/strict'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { isPrivateHost, stripPrivateEndpoints } from './net.ts'

test('isPrivateHost', () => {
  const host = (url: string) => new URL(url).hostname
  for (const url of [
    'http://localhost/',
    'http://localhost./',
    'http://127.0.0.1/',
    'http://2130706433/', // normalised by URL to 127.0.0.1
    'http://192.168.1.20/',
    'http://10.0.0.5/',
    'http://172.20.1.1/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://nas/',
    'http://jackett.local/',
    'http://box.home.arpa/'
  ]) {
    assert.equal(isPrivateHost(host(url)), true, url)
  }
  for (const url of [
    'http://example.com/',
    'http://8.8.8.8/',
    'http://172.32.0.1/',
    'http://[2001:4860:4860::8888]/',
    'http://[::ffff:8.8.8.8]/',
    'http://127.0.0.1.nip.io/',
    'http://localhost.evil.com/'
  ]) {
    assert.equal(isPrivateHost(host(url)), false, url)
  }
})

test('stripPrivateEndpoints keeps the info hash but drops LAN and plain-http endpoints', async () => {
  const original = toTorrentFile({
    infoHash: '',
    info: { name: new TextEncoder().encode('x'), 'piece length': 16384, pieces: new Uint8Array(20), length: 1 },
    announce: ['udp://tracker.example.org:1337', 'http://192.168.1.1/announce'],
    urlList: ['https://cdn.example.org/', 'http://cdn.example.org/', 'https://10.0.0.2/']
  })
  const before = await parseTorrent(original)
  const after = await parseTorrent(await stripPrivateEndpoints(original))
  assert.equal(after.infoHash, before.infoHash)
  assert.deepEqual(after.announce, ['udp://tracker.example.org:1337'])
  assert.deepEqual(after.urlList, ['https://cdn.example.org/'])
})

test('sanitizeThirdPartyMagnet keeps hash, name and public endpoints only', async () => {
  const { sanitizeThirdPartyMagnet } = await import('./net.ts')
  const hash = 'c9e15763f722f23e98a29decdfae341b98d53056'
  const uri =
    `magnet:?xt=urn:btih:${hash}&dn=Album&tr=udp%3A%2F%2Ftracker.example.org%3A1337&tr=http%3A%2F%2F192.168.1.1%2Fannounce` +
    `&ws=https%3A%2F%2Fcdn.example.org%2F&ws=http%3A%2F%2Fcdn.example.org%2F&x.pe=127.0.0.1:8080&kt=x`
  assert.equal(
    sanitizeThirdPartyMagnet(uri),
    `magnet:?xt=urn:btih:${hash}&dn=Album&tr=udp%3A%2F%2Ftracker.example.org%3A1337&ws=https%3A%2F%2Fcdn.example.org%2F`
  )
})
