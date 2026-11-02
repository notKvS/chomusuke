import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CookieJar } from './cookie-jar.ts'

test('cookies a site sets come back on its next requests, per host', () => {
  const jar = new CookieJar()
  assert.equal(jar.header('example.org'), undefined)
  jar.store('example.org', 'bb_session=abc123; path=/forum/; secure; HttpOnly')
  jar.store('example.org', 'bb_guid=xyz; Max-Age=3600')
  assert.equal(jar.header('example.org'), 'bb_session=abc123; bb_guid=xyz')
  assert.equal(jar.header('mirror.example.org'), undefined)

  // A later Set-Cookie replaces the value.
  jar.store('example.org', 'bb_session=def456')
  assert.equal(jar.header('example.org'), 'bb_session=def456; bb_guid=xyz')
})

test('cookies that expire or are cleared go away', () => {
  let clock = 1_000_000
  const jar = new CookieJar(() => clock)
  jar.store('a.example', 'short=1; Max-Age=60')
  jar.store('a.example', `dated=2; Expires=${new Date(clock + 120_000).toUTCString()}`)
  jar.store('a.example', 'plain=3')
  assert.equal(jar.header('a.example'), 'short=1; dated=2; plain=3')
  clock += 90_000
  assert.equal(jar.header('a.example'), 'dated=2; plain=3')
  clock += 60_000
  assert.equal(jar.header('a.example'), 'plain=3')

  // Deleting: an empty value, Max-Age 0, or an Expires in the past (Max-Age wins over Expires).
  jar.store('a.example', 'plain=')
  assert.equal(jar.header('a.example'), undefined)
  jar.store('a.example', 'one=1')
  jar.store('a.example', 'one=1; Max-Age=0')
  assert.equal(jar.header('a.example'), undefined)
  jar.store('a.example', 'two=2')
  jar.store('a.example', 'two=2; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  assert.equal(jar.header('a.example'), undefined)
  jar.store('a.example', `three=3; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT`)
  assert.equal(jar.header('a.example'), 'three=3')
})

test('malformed or oversized cookies are ignored, and a host keeps at most 50', () => {
  const jar = new CookieJar()
  for (const bad of ['', 'novalue', '=x', 'a b=1', 'a=1 2', `a=${'x'.repeat(5000)}`, 'x\ny=1']) {
    jar.store('a.example', bad)
  }
  assert.equal(jar.header('a.example'), undefined)
  for (let i = 0; i < 80; i++) jar.store('a.example', `c${i}=v`)
  assert.equal(jar.header('a.example')?.split('; ').length, 50)
  // An existing cookie can still be updated once the host is full.
  jar.store('a.example', 'c0=new')
  assert.match(jar.header('a.example') ?? '', /c0=new/)
})
