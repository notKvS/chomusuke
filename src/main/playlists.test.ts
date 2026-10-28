import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { PlaylistError, PlaylistStore, sanitizePlaylist } from './playlists.ts'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const song = (hash: string, key: string, title: string) => ({
  infoHash: hash,
  key,
  title,
  artist: 'Band',
  magnet: `magnet:?xt=urn:btih:${hash}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&x.pe=192.168.0.2:6881`
})

async function withStore(run: (store: PlaylistStore, file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-playlists-'))
  try {
    const file = path.join(dir, 'playlists.json')
    const store = new PlaylistStore(file)
    await store.load()
    await run(store, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('create, add across torrents, dedupe, reorder, remove, rename — and it all persists', () =>
  withStore(async (store, file) => {
    const { id } = await store.create('  Road trip  ')
    assert.equal(store.list()[0].name, 'Road trip')
    await assert.rejects(store.create('   '), PlaylistError)

    assert.equal(await store.add(id, [song(A, 'x/01', 'One'), song(B, 'y/02', 'Two'), song(A, 'x/01', 'One')]), 2)
    assert.equal(await store.add(id, [song(A, 'x/01', 'One'), { infoHash: 'nope', key: 'k', title: 't' }]), 0)
    await store.move(id, 1, 0)
    assert.deepEqual(
      store.list()[0].songs.map(s => s.title),
      ['Two', 'One']
    )
    await store.move(id, 0, 99) // out of range: ignored
    await store.removeSong(id, `${A}:x/01`)
    await store.rename(id, 'Night drive')

    const reloaded = new PlaylistStore(file)
    await reloaded.load()
    const [playlist] = reloaded.list()
    assert.equal(playlist.name, 'Night drive')
    assert.deepEqual(
      playlist.songs.map(s => s.title),
      ['Two']
    )
    assert.doesNotMatch(playlist.songs[0].magnet, /x\.pe/) // LAN peers never stored
    await reloaded.remove(id)
    assert.deepEqual(reloaded.list(), [])
  }))

test('backup merge: newer copy wins, new playlists are added, junk is dropped', () =>
  withStore(async store => {
    const { id } = await store.create('Mine')
    await store.add(id, [song(A, 'x/01', 'One')])
    const newer = { ...store.list()[0], name: 'Mine (from laptop)', updatedAt: '2099-01-01T00:00:00.000Z' }
    const other = { id: '00000000-0000-4000-8000-000000000000', name: 'Other', songs: [song(B, 'y/02', 'Two')] }
    assert.equal(await store.merge([newer, other, { id: '../etc', name: 'x' }]), 2)
    assert.deepEqual(
      store.list().map(p => p.name),
      ['Mine (from laptop)', 'Other']
    )
    assert.equal(await store.merge([newer]), 0)
    assert.equal(sanitizePlaylist({ id: '00000000-0000-4000-8000-000000000000', name: '' }), undefined)
  }))
