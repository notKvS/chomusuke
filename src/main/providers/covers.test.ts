import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CoverFinder, type CoverWanted, pickItunesCover } from './covers.ts'
import type { ProviderAlbum } from './types.ts'

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ce/6d/cover.jpg/100x100bb.jpg'
const BIG = 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ce/6d/cover.jpg/600x600bb.jpg'

test('iTunes covers only count when the artist and title match', () => {
  const song: CoverWanted = { kind: 'song', title: 'Arz Kiya Hai', artist: 'Anuv Jain' }
  const results = [
    { artistName: 'Karaoke Stars', trackName: 'Arz Kiya Hai', artworkUrl100: 'https://is1-ssl.mzstatic.com/a.jpg' },
    { artistName: 'Anuv Jain', trackName: 'Arz Kiya Hai (Coke Studio Bharat)', artworkUrl100: ART }
  ]
  assert.equal(pickItunesCover(song, results), BIG)
  // Guests on either side, and store suffixes, still match.
  assert.equal(
    pickItunesCover({ kind: 'song', title: 'BbY WOW', artist: 'KAROL G, Judeline' }, [
      { artistName: 'KAROL G', trackName: 'BbY WOW', artworkUrl100: ART }
    ]),
    BIG
  )
  assert.equal(
    pickItunesCover({ kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' }, [
      { artistName: 'Lady Gaga', collectionName: 'Mayhem - Single', artworkUrl100: ART }
    ]),
    BIG
  )
  assert.equal(
    pickItunesCover(song, [{ artistName: 'Anuv Jain', trackName: 'Baarishein', artworkUrl100: ART }]),
    undefined
  )
  // Albums are matched on the album name, not a track's.
  assert.equal(
    pickItunesCover({ kind: 'album', title: 'Mayhem', artist: 'Lady Gaga' }, [
      { artistName: 'Lady Gaga', trackName: 'Mayhem', artworkUrl100: ART }
    ]),
    undefined
  )
  // Only Apple's image CDN, over https.
  assert.equal(
    pickItunesCover(song, [
      { artistName: 'Anuv Jain', trackName: 'Arz Kiya Hai', artworkUrl100: 'https://evil.example/a.jpg' }
    ]),
    undefined
  )
  assert.equal(pickItunesCover(song, 'nope'), undefined)
})

const entry = (title: string, artwork?: string): ProviderAlbum => ({
  ref: title,
  title,
  artist: 'Artist',
  chart: 'song',
  ...(artwork ? { artwork } : {})
})

test('missing covers are looked up once, within the rate limit', async () => {
  const asked: string[] = []
  let now = 0
  const finder = new CoverFinder(
    async wanted => {
      asked.push(wanted.title)
      return wanted.title === 'None' ? undefined : `https://is1-ssl.mzstatic.com/${wanted.title}.jpg`
    },
    () => now
  )
  const filled = await finder.fill([entry('A'), entry('B', 'https://i.scdn.co/image/b'), entry('None')])
  assert.deepEqual(
    filled.map(a => a.artwork),
    ['https://is1-ssl.mzstatic.com/A.jpg', 'https://i.scdn.co/image/b', undefined]
  )
  assert.deepEqual(asked.sort(), ['A', 'None'])

  // Found and known-missing covers are remembered.
  await finder.fill([entry('A'), entry('None')])
  assert.equal(asked.length, 2)

  // 20 lookups a minute: the rest keep their placeholder until the minute is up.
  const many = Array.from({ length: 30 }, (_, i) => entry(`Song ${i}`))
  const first = await finder.fill(many)
  assert.equal(first.filter(a => a.artwork).length, 18)
  now += 60_000
  const later = await finder.fill(many)
  assert.equal(later.filter(a => a.artwork).length, 30)
})

test('a failed lookup is tried again next time', async () => {
  let fail = true
  const finder = new CoverFinder(async () => {
    if (fail) throw new Error('offline')
    return 'https://is1-ssl.mzstatic.com/a.jpg'
  })
  assert.equal((await finder.fill([entry('A')]))[0].artwork, undefined)
  fail = false
  assert.equal((await finder.fill([entry('A')]))[0].artwork, 'https://is1-ssl.mzstatic.com/a.jpg')
})
