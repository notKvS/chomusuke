import { songFingerprint } from '../../shared/fingerprint.ts'
import type { HomeShelf, SearchAlbum } from '../../shared/types.ts'
import { MBID } from '../genres.ts'
import { leadArtist, sanitizePlay } from '../history.ts'
import { ARTIST_SHELVES, planHome } from '../home.ts'
import { pickSongs, type SimilarSong } from '../similar.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

/** How long Home waits for artist genres before it shows what it has. */
const GENRES_TIMEOUT_MS = 5000
/** Artists looked up on MusicBrainz: for the genre shelf, and the similar-artist shelves. */
const GENRE_ARTISTS = 2
/** How long a similar-artist shelf waits for ListenBrainz and covers. */
const SIMILAR_TIMEOUT_MS = 20_000
const SIMILAR_SHELF_SIZE = 12
/** Songs the radio is offered at a time: it plays the first one a plugin can find. */
const RADIO_CANDIDATES = 4

/** What you played lately, and the Home shelves made from it. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, history, ratings, registry, artistInfo, similarSongs } = deps

  /** Songs not worth suggesting: ones played lately, and rated ones (liked: you know it; disliked: you don't want it). */
  const knownSongs = (): Set<string> => {
    const known = history.fingerprints()
    for (const song of ratings.list()) {
      const key = song.fingerprint ?? songFingerprint(song.title, song.artist)
      if (key) known.add(key)
    }
    return known
  }

  /** Suggested songs as albums the renderer can open. */
  const suggest = (songs: SimilarSong[], signal: AbortSignal): Promise<SearchAlbum[]> =>
    registry.suggest(
      songs.map(song => ({
        kind: 'song',
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.artwork
      })),
      signal
    )

  handle('history:record', async (event, raw: unknown) => {
    assertTrustedSender(event)
    await history.record(raw)
  })

  handle('history:size', (event): number => {
    assertTrustedSender(event)
    return history.size
  })

  handle('history:clear', async (event): Promise<void> => {
    assertTrustedSender(event)
    await history.clear()
  })

  handle('home:shelves', async (event): Promise<HomeShelf[]> => {
    assertTrustedSender(event)
    const artists = history.topArtists(Math.max(ARTIST_SHELVES, GENRE_ARTISTS))
    const signal = AbortSignal.timeout(GENRES_TIMEOUT_MS)
    const infos = await Promise.all(artists.slice(0, GENRE_ARTISTS).map(artist => artistInfo(artist, signal)))
    return planHome({
      artists,
      genres: infos.map(info => info.tags),
      mbids: infos.map(info => info.mbid),
      charts: registry.explore().charts,
      random: Math.random
    })
  })

  handle('home:similar', async (event, artistMbid: unknown): Promise<SearchAlbum[]> => {
    assertTrustedSender(event)
    if (typeof artistMbid !== 'string' || !MBID.test(artistMbid)) return []
    const signal = AbortSignal.timeout(SIMILAR_TIMEOUT_MS)
    const songs = pickSongs(await similarSongs(artistMbid, signal), {
      skip: knownSongs(),
      skipArtist: artistMbid,
      limit: SIMILAR_SHELF_SIZE
    })
    return suggest(songs, signal)
  })

  // What to play when the music runs out: songs you don't know yet by artists like the one of the song that ended.
  handle('radio:next', async (event, raw: unknown): Promise<SearchAlbum[]> => {
    assertTrustedSender(event)
    const ended = sanitizePlay(raw)
    if (!ended?.artist) return []
    const signal = AbortSignal.timeout(SIMILAR_TIMEOUT_MS)
    const { mbid } = await artistInfo(leadArtist(ended.artist), signal)
    if (!mbid) return []
    const songs = pickSongs(await similarSongs(mbid, signal), {
      skip: knownSongs(),
      skipArtist: mbid,
      limit: RADIO_CANDIDATES
    })
    return suggest(songs, signal)
  })
}
