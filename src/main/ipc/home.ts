import type { HomeShelf } from '../../shared/types.ts'
import { ARTIST_SHELVES, planHome } from '../home.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

/** How long Home waits for artist genres before it shows what it has. */
const GENRES_TIMEOUT_MS = 5000
/** Artists considered for the genre shelf. */
const GENRE_ARTISTS = 2

/** What you played lately, and the Home shelves made from it. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, history, registry, artistGenres } = deps

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
    const genres = await Promise.all(artists.slice(0, GENRE_ARTISTS).map(artist => artistGenres(artist, signal)))
    return planHome({ artists, genres, charts: registry.explore().charts, random: Math.random })
  })
}
