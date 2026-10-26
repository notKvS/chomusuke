import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DEFAULT_SHARING, LibraryError, SeedLibrary, sanitizeEntry, sanitizeSharing } from './seeding.ts'

const HASH = 'a'.repeat(40)
const HASH2 = 'b'.repeat(40)

async function withLibrary(run: (library: SeedLibrary, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-library-'))
  try {
    const library = new SeedLibrary(dir)
    await library.load()
    await run(library, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('sharing is on by default and only accepts known values', () => {
  assert.deepEqual(sanitizeSharing(undefined), DEFAULT_SHARING)
  assert.equal(DEFAULT_SHARING.seedStreamed, true)
  assert.deepEqual(
    sanitizeSharing({ enabled: false, seedLibrary: 'no', seedStreamed: false, streamCacheGB: 5, uploadLimitKBps: 512 }),
    { enabled: false, seedLibrary: true, seedStreamed: false, streamCacheGB: 5, uploadLimitKBps: 512 }
  )
  assert.equal(sanitizeSharing({ uploadLimitKBps: 3 }).uploadLimitKBps, 0)
  assert.equal(sanitizeSharing({ streamCacheGB: 999 }).streamCacheGB, DEFAULT_SHARING.streamCacheGB)
})

test('streamed albums: recorded, touched, evicted least-recently-played first, promoted when kept', () =>
  withLibrary(async (library, dir) => {
    const HASH3 = 'c'.repeat(40)
    const fill = async (hash: string, bytes: number) => {
      await mkdir(library.dataPath(hash), { recursive: true })
      await writeFile(path.join(library.dataPath(hash), 'track.mp3'), Buffer.alloc(bytes))
    }
    await library.recordStreamed({ infoHash: HASH, title: 'Old', addedAt: '2026-01-01T00:00:00Z' }, new Uint8Array([1]))
    await library.recordStreamed(
      { infoHash: HASH2, title: 'New', addedAt: '2026-06-01T00:00:00Z' },
      new Uint8Array([2])
    )
    await library.recordStreamed(
      { infoHash: HASH3, title: 'Empty', addedAt: '2026-07-01T00:00:00Z' },
      new Uint8Array([3])
    )
    await fill(HASH, 700)
    await fill(HASH2, 600)
    assert.deepEqual(
      library.listStreamed().map(e => e.title),
      ['Empty', 'New', 'Old']
    )

    // Playing "Old" again makes it the most recent, so "New" is the one evicted when only one fits.
    await library.touch(HASH)
    const used = await library.enforceStreamCap(1000)
    assert.equal(used, 700)
    assert.deepEqual(
      library.listStreamed().map(e => e.title),
      ['Old']
    )
    await library.purge()
    assert.deepEqual(await readdir(path.join(dir, 'data')), [HASH])

    // Keeping a streamed album promotes it; a dropped one isn't re-recorded this session.
    await library.add({ infoHash: HASH, title: 'Old' }, new Uint8Array([1]))
    assert.equal(library.has(HASH), true)
    assert.deepEqual(library.listStreamed(), [])
    await library.recordStreamed({ infoHash: HASH2, title: 'New' }, new Uint8Array([2]))
    assert.deepEqual(library.listStreamed(), [])
  }))

test('opting out clears streamed albums', () =>
  withLibrary(async library => {
    await library.recordStreamed({ infoHash: HASH, title: 'Streamed' }, new Uint8Array([1]))
    await library.clearStreamed()
    assert.deepEqual(library.listStreamed(), [])
    await assert.rejects(library.readTorrent(HASH), LibraryError)
  }))

test('entries are validated: hash, text, https artwork only', () => {
  assert.equal(sanitizeEntry({ infoHash: '../etc', title: 'x' }), undefined)
  const entry = sanitizeEntry({
    infoHash: HASH,
    title: '  Album\nTitle ',
    coverUrl: 'http://127.0.0.1:5000/x/cover.jpg',
    size: -5
  })
  assert.equal(entry?.title, 'Album Title')
  assert.equal(entry?.coverUrl, undefined)
  assert.equal(entry?.size, 0)
  assert.equal(
    sanitizeEntry({ infoHash: HASH, coverUrl: 'https://archive.org/services/img/x' })?.coverUrl,
    'https://archive.org/services/img/x'
  )
})

test('keeps albums across reloads, with their torrent files and settings', () =>
  withLibrary(async (library, dir) => {
    await library.add({ infoHash: HASH, title: 'Kept', size: 100 }, new Uint8Array([1, 2, 3]))
    await library.setSharing({ enabled: false, seedLibrary: false, uploadLimitKBps: 256 })
    const reloaded = new SeedLibrary(dir)
    await reloaded.load()
    assert.equal(reloaded.has(HASH), true)
    assert.deepEqual([...(await reloaded.readTorrent(HASH))], [1, 2, 3])
    assert.deepEqual(reloaded.sharing, { ...DEFAULT_SHARING, enabled: false, seedLibrary: false, uploadLimitKBps: 256 })
    assert.equal(reloaded.dataPath(HASH), path.join(dir, 'data', HASH))
    assert.throws(() => reloaded.dataPath('nope'), LibraryError)
  }))

test('adopts cached files on quit and purges removed or orphaned folders', () =>
  withLibrary(async (library, dir) => {
    await library.add({ infoHash: HASH, title: 'Kept' }, new Uint8Array([1]))
    await library.add({ infoHash: HASH2, title: 'Removed' }, new Uint8Array([2]))
    const cached = path.join(dir, 'cache-uuid')
    await mkdir(path.join(cached, 'Album'), { recursive: true })
    await writeFile(path.join(cached, 'Album', '01.mp3'), 'audio')
    await library.adopt(HASH, cached)
    assert.equal(await readFile(path.join(dir, 'data', HASH, 'Album', '01.mp3'), 'utf8'), 'audio')

    await mkdir(library.dataPath(HASH2), { recursive: true })
    await mkdir(path.join(dir, 'data', 'stray'), { recursive: true })
    await library.remove(HASH2)
    await library.purge()
    assert.deepEqual(await readdir(path.join(dir, 'data')), [HASH])
    await assert.rejects(async () => library.readTorrent(HASH2), LibraryError)
  }))
