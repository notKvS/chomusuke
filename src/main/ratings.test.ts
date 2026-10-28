import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { normalizeText, songFingerprint } from '../shared/fingerprint.ts'
import { BACKUP_FORMAT, BackupError, buildBackup, parseBackup } from './backup.ts'
import { RatingsStore, sanitizeRatedSong } from './ratings.ts'

const HASH = 'a'.repeat(40)
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Album&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=http%3A%2F%2F192.168.1.5%2Fannounce&x.pe=10.0.0.2:6881`
const song = { infoHash: HASH, key: 'Album/01 - Song', title: 'Song', artist: 'Band', album: 'Album', magnet: MAGNET }

async function withStore(run: (store: RatingsStore, file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-ratings-'))
  try {
    const file = path.join(dir, 'ratings.json')
    const store = new RatingsStore(file)
    await store.load()
    await run(store, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('fingerprints match the same song across releases, not generic titles', () => {
  assert.equal(normalizeText('Beyoncé — Halo!'), 'beyonce halo')
  const halo = 'beyonce|halo'
  // Same song, different naming per source: accents, case, track numbers, edition/format tags, guests, file names.
  for (const [title, artist] of [
    ['Halo', 'Beyoncé'],
    ['03 - Halo (Remastered 2019)', 'BEYONCE'],
    ['Halo_[FLAC]', 'Beyonce'],
    ['Halo - Radio Edit', 'Beyonce'],
    ['Halo (feat. Someone)', 'Beyoncé'],
    ['01. Beyoncé - Halo [320 kbps]', undefined]
  ]) {
    assert.equal(songFingerprint(title as string, artist), halo, `${artist} / ${title}`)
  }
  // Different recordings stay different; titles that contain "with" aren't treated as guests.
  assert.equal(songFingerprint('Halo (Live)', 'Beyonce'), 'beyonce|halo live')
  assert.equal(songFingerprint('With or Without You', 'U2'), 'u2|with or without you')
  assert.equal(songFingerprint('Bohemian Rhapsody', 'The Queen'), songFingerprint('Bohemian Rhapsody', 'Queen'))
  // Voicing marks in Japanese change the word, so they're kept.
  assert.notEqual(normalizeText('ビ'), normalizeText('ヒ'))
  assert.equal(songFingerprint('Song feat. Someone', 'Band'), 'band|song')
  assert.equal(songFingerprint('Track 01'), undefined)
  assert.equal(songFingerprint('Intro'), undefined)
  assert.equal(songFingerprint('Intro', 'Band'), 'band|intro')
})

test('rated songs are validated; magnets lose LAN trackers and peers', () => {
  const clean = sanitizeRatedSong({ ...song, rating: 1 })
  assert.equal(clean?.id, `${HASH}:Album/01 - Song`)
  assert.equal(clean?.fingerprint, 'band|song')
  assert.match(clean?.magnet ?? '', /opentrackr/)
  assert.doesNotMatch(clean?.magnet ?? '', /192\.168|x\.pe/)
  assert.equal(sanitizeRatedSong({ ...song, rating: 2 }), undefined)
  assert.equal(sanitizeRatedSong({ ...song, infoHash: '../x', rating: 1 }), undefined)
  // A magnet for another torrent is replaced by a bare one for this hash.
  assert.equal(
    sanitizeRatedSong({ ...song, magnet: `magnet:?xt=urn:btih:${'b'.repeat(40)}`, rating: 1 })?.magnet,
    `magnet:?xt=urn:btih:${HASH}`
  )
})

test('likes, dislikes and clears persist', () =>
  withStore(async (store, file) => {
    await store.set(song, 1)
    await store.set({ ...song, key: 'Album/02 - Other', title: 'Other' }, -1)
    const reloaded = new RatingsStore(file)
    await reloaded.load()
    assert.deepEqual(
      reloaded.list().map(s => [s.title, s.rating]),
      [
        ['Other', -1],
        ['Song', 1]
      ]
    )
    await reloaded.set(song, 0)
    assert.deepEqual(
      reloaded.list().map(s => s.title),
      ['Other']
    )
  }))

test('backup round-trip; merge keeps the newest rating per song', () =>
  withStore(async store => {
    await store.set(song, 1)
    const backup = buildBackup({
      app: 'Chomusuke test',
      ratings: [{ ...store.list()[0], rating: -1, ratedAt: '2099-01-01T00:00:00.000Z' }],
      albums: [{ infoHash: HASH, title: 'Album', magnet: MAGNET }],
      playlists: [],
      appearance: { accent: '#3ec7ff' }
    })
    assert.equal(backup.format, BACKUP_FORMAT)
    const parsed = parseBackup(JSON.stringify(backup))
    assert.doesNotMatch(parsed.albums[0].magnet, /x\.pe|192\.168/)
    assert.deepEqual(parsed.appearance, { accent: '#3ec7ff' })
    assert.equal(await store.merge(parsed.ratings), 1)
    assert.equal(store.list()[0].rating, -1)
    assert.equal(await store.merge(parsed.ratings), 0) // same timestamp again: nothing to change
    assert.throws(() => parseBackup('{"format":"something-else"}'), BackupError)
    assert.throws(() => parseBackup('not json'), BackupError)
    assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 99 })), /newer version/)
  }))
