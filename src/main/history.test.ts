import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { leadArtist, PlayHistory, sanitizePlay } from './history.ts'

async function withHistory(run: (history: PlayHistory, file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-history-'))
  try {
    const file = path.join(dir, 'history.json')
    const history = new PlayHistory(file)
    await history.load()
    await run(history, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('plays are cleaned up, and need a title', () => {
  assert.equal(sanitizePlay({ artist: 'Nobody' }), undefined)
  assert.equal(sanitizePlay('song'), undefined)
  const play = sanitizePlay({ title: '  Yellow\n', artist: 'Coldplay', album: 'Parachutes', playedAt: 'junk' })
  assert.equal(play?.title, 'Yellow')
  assert.equal(play?.artist, 'Coldplay')
  assert.equal(play?.album, 'Parachutes')
  assert.ok(play && !Number.isNaN(Date.parse(play.playedAt)))
})

test('the lead artist is the first one credited', () => {
  assert.equal(leadArtist('Tate McRae'), 'Tate McRae')
  assert.equal(leadArtist('KAROL G, Judeline'), 'KAROL G')
  assert.equal(leadArtist('Dua Lipa feat. Elton John'), 'Dua Lipa')
  assert.equal(leadArtist('Simon & Garfunkel'), 'Simon')
  assert.equal(leadArtist('Malcolm X'), 'Malcolm X')
})

test('plays are kept across restarts, a repeat counts once, and the oldest go first', () =>
  withHistory(async (history, file) => {
    await history.record({ title: 'Yellow', artist: 'Coldplay' })
    await history.record({ title: 'yellow', artist: 'COLDPLAY' })
    await history.record({ title: 'Clocks', artist: 'Coldplay' })
    await history.record({ nonsense: true })
    assert.equal(history.size, 2)

    const reloaded = new PlayHistory(file)
    await reloaded.load()
    assert.equal(reloaded.size, 2)

    for (let i = 0; i < 520; i++) await history.record({ title: `Song ${i}`, artist: 'Band' })
    assert.equal(history.size, 500)
    const saved = JSON.parse(await readFile(file, 'utf8')) as { plays: Array<{ title: string }> }
    assert.equal(saved.plays[0].title, 'Song 20')
    assert.equal(saved.plays.at(-1)?.title, 'Song 519')

    await history.clear()
    assert.equal(history.size, 0)
    const cleared = new PlayHistory(file)
    await cleared.load()
    assert.equal(cleared.size, 0)
  }))

test('the artists you play most come first, and recent plays count for more', () =>
  withHistory(async history => {
    // An old favourite, played more than either of the new ones (20 plays against 15)…
    for (let i = 0; i < 20; i++) await history.record({ title: `Old ${i}`, artist: 'Old Favourite' })
    // …then what's been on lately.
    for (let i = 0; i < 30; i++) {
      await history.record({ title: `New ${i}`, artist: i % 2 ? 'Fresh Band, Guest' : 'Other Band' })
    }
    await history.record({ title: 'No artist' })
    assert.deepEqual(history.topArtists(3), ['Fresh Band', 'Other Band', 'Old Favourite'])
    assert.deepEqual(history.topArtists(1), ['Fresh Band'])
  }))

test('a damaged history file is ignored', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-history-'))
  try {
    const file = path.join(dir, 'history.json')
    await writeFile(file, '{"plays": [{"title": "Ok"}, 7, {"artist": "x"}]}')
    const history = new PlayHistory(file)
    await history.load()
    assert.equal(history.size, 1)
    await writeFile(file, 'not json')
    const broken = new PlayHistory(file)
    await broken.load()
    assert.equal(broken.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
