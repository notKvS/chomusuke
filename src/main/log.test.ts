import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLogExport, describeArgs, failureOf, scrub } from './log.ts'

test('the stream server token never reaches the log', () => {
  const url = `http://127.0.0.1:5123/media/${'ab'.repeat(32)}/${'c'.repeat(40)}/3`
  assert.equal(scrub(`playing ${url}`), `playing http://127.0.0.1:5123/media/<token>/${'c'.repeat(40)}/3`)
})

test('keys, passkeys and passwords in URLs are hidden', () => {
  assert.equal(
    scrub('GET https://indexer.example/api?t=search&apikey=s3cret&q=abba → net::ERR_FAILED'),
    'GET https://indexer.example/api?t=search&apikey=<hidden>&q=abba → net::ERR_FAILED'
  )
  assert.equal(scrub('https://t.example/announce?passkey=123abc'), 'https://t.example/announce?passkey=<hidden>')
  assert.equal(scrub('https://x.example/?token=a&api_key=b'), 'https://x.example/?token=<hidden>&api_key=<hidden>')
})

test('IPC arguments are logged compactly, without secrets', () => {
  assert.equal(describeArgs(['abba gold']), '"abba gold"')
  assert.equal(
    describeArgs([{ name: 'Jackett', url: 'https://j.example', apiKey: 'k' }]),
    '{"name":"Jackett","url":"https://j.example","apiKey":"<hidden>"}'
  )
  assert.equal(describeArgs([{ password: 'p', Cookie: 'c' }]), '{"password":"<hidden>","Cookie":"<hidden>"}')
  // Track keys are not secrets.
  assert.equal(describeArgs(['hash', 'disc1/01.flac', 'like']), '"hash", "disc1/01.flac", "like"')
  assert.ok(describeArgs(['x'.repeat(5000)]).length < 600)
})

test('a failed IPC answer is recognised by its error message', () => {
  assert.equal(failureOf({ ok: false, error: 'No peers' }), 'No peers')
  assert.equal(failureOf({ ok: true, album: {} }), undefined)
  assert.equal(failureOf(undefined), undefined)
})

test('an exported log has the header first and no secrets, even from older lines', () => {
  const text = buildLogExport(
    ['Chomusuke 1.0 log', 'Sources in search order: Audius, Jamendo'],
    ['[old] GET https://x.example/?apikey=abc', '', `[new] ok /media/${'ab'.repeat(32)}/1`]
  )
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, 3), ['Chomusuke 1.0 log', 'Sources in search order: Audius, Jamendo', ''])
  assert.doesNotMatch(text, /abc|abab/)
  assert.match(text, /apikey=<hidden>/)
  assert.match(text, /\/media\/<token>/)
})
