import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCover, sanitizeNowPlaying, toActivity } from './discord.ts'

const song = {
  title: 'Halo',
  artist: 'Beyoncé',
  album: 'I Am… Sasha Fierce',
  coverUrl: 'https://is1-ssl.mzstatic.com/image/cover.jpg',
  playing: true,
  position: 30,
  duration: 240
}

test('only a titled song with a remote https cover gets through from the renderer', () => {
  assert.deepEqual(sanitizeNowPlaying(song), song)
  assert.equal(sanitizeNowPlaying(null), null)
  assert.equal(sanitizeNowPlaying({ ...song, title: '  ' }), null)
  // Covers from the local stream server can't be loaded by Discord.
  assert.equal(sanitizeNowPlaying({ ...song, coverUrl: 'http://127.0.0.1:4000/media/x/y/0' })?.coverUrl, undefined)
  assert.equal(sanitizeNowPlaying({ ...song, coverUrl: `https://a.com/${'x'.repeat(300)}` })?.coverUrl, undefined)
  const odd = sanitizeNowPlaying({ title: 'Song', playing: 'yes', position: -5, duration: Number.NaN })
  assert.deepEqual(odd, {
    title: 'Song',
    artist: undefined,
    album: undefined,
    coverUrl: undefined,
    playing: false,
    position: 0,
    duration: 0
  })
})

test('a playing song shows its progress and the download button', () => {
  const at = 1_000_000
  const activity = toActivity(song, at)
  assert.equal(activity.details, 'Halo')
  assert.equal(activity.state, 'by Beyoncé')
  assert.equal(activity.largeImageKey, song.coverUrl)
  assert.equal(activity.largeImageText, song.album)
  assert.equal(activity.startTimestamp, at - 30_000)
  assert.equal(activity.endTimestamp, at + 210_000)
  assert.deepEqual(activity.buttons, [
    { label: 'Get Chomusuke', url: 'https://github.com/notKvS/chomusuke/releases/latest' }
  ])
})

test('text fits Discord’s 2–128 character fields, and a missing cover falls back to the logo', () => {
  const activity = toActivity({ title: 'X'.repeat(200), album: 'A', playing: true, position: 0, duration: 0 }, 0)
  assert.equal(activity.details?.length, 128)
  assert.ok(activity.details?.endsWith('…'))
  assert.equal(activity.largeImageText?.length, 2)
  assert.equal(activity.state, 'A'.padEnd(2, '​'))
  assert.match(activity.largeImageKey ?? '', /^https:\/\/raw\.githubusercontent\.com\/notKvS\/chomusuke\//)
  // Duration not known yet: no progress bar rather than a wrong one.
  assert.equal(activity.startTimestamp, undefined)
})

test('a song whose cover only exists on this computer gets one from the catalogue, by title then album', async () => {
  const local = { ...song, coverUrl: undefined }
  const asked: string[] = []
  const found = await resolveCover(local, async wanted => {
    asked.push(`${wanted.kind}:${wanted.title}:${wanted.artist}`)
    return wanted.kind === 'album' ? 'https://is1-ssl.mzstatic.com/image/cover/600x600bb.jpg' : undefined
  })
  assert.deepEqual(asked, ['song:Halo:Beyoncé', 'album:I Am… Sasha Fierce:Beyoncé'])
  assert.equal(found.coverUrl, 'https://is1-ssl.mzstatic.com/image/cover/600x600bb.jpg')
  assert.equal(toActivity(found, 0).largeImageKey, found.coverUrl)

  // Nothing found (or the lookup failing) keeps the logo.
  assert.equal((await resolveCover(local, async () => undefined)).coverUrl, undefined)
  assert.equal(
    (
      await resolveCover(local, async () => {
        throw new Error('offline')
      })
    ).coverUrl,
    undefined
  )
})

test('covers that already load from the web, or songs with no artist, are not looked up', async () => {
  const never = async () => {
    throw new Error('should not be asked')
  }
  assert.equal(await resolveCover(song, never), song)
  const anonymous = { ...song, coverUrl: undefined, artist: undefined }
  assert.equal(await resolveCover(anonymous, never), anonymous)
  assert.equal(await resolveCover({ ...song, coverUrl: undefined }, undefined).then(s => s.coverUrl), undefined)
  // A result that isn't a usable https URL is ignored.
  const odd = await resolveCover({ ...song, coverUrl: undefined }, async () => 'http://127.0.0.1/x.jpg')
  assert.equal(odd.coverUrl, undefined)
})
