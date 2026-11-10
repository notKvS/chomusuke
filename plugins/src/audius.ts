// Audius: an open music platform with a free API that needs no key. Search finds tracks; opening one gives its
// stream URL, which the app plays directly. API reference: https://docs.audius.co
import type { Paged, StreamAlbum, StreamPlugin, StreamResult } from './sdk'

const API = 'https://api.audius.co/v1'
const APP = 'chomusuke'
const PAGE_SIZE = 24

interface AudiusTrack {
  id?: string
  title?: string
  duration?: number
  release_date?: string
  genre?: string
  is_streamable?: boolean
  user?: { name?: string }
  artwork?: Record<string, string> | null
}

async function getTracks(path: string): Promise<AudiusTrack[]> {
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}app_name=${APP}`)
  if (!res.ok) throw new Error(`Audius answered with an error (${res.status}).`)
  const body = (await res.json()) as { data?: AudiusTrack[] | AudiusTrack }
  return Array.isArray(body.data) ? body.data : body.data ? [body.data] : []
}

const artworkOf = (track: AudiusTrack): string | undefined =>
  track.artwork?.['480x480'] ?? track.artwork?.['1000x1000'] ?? track.artwork?.['150x150']

function toResult(track: AudiusTrack): StreamResult | undefined {
  if (!track.id || !track.title || track.is_streamable === false) return undefined
  return {
    id: track.id,
    title: track.title,
    artist: track.user?.name,
    year: track.release_date?.slice(0, 4),
    artwork: artworkOf(track),
    tags: track.genre ? [track.genre.slice(0, 12)] : undefined
  }
}

const page = (tracks: AudiusTrack[], size = PAGE_SIZE): Paged<StreamResult> => ({
  results: tracks.map(toResult).filter((r): r is StreamResult => r !== undefined),
  hasMore: tracks.length >= size
})

export default {
  async test() {
    const found = await getTracks('/tracks/trending?limit=1')
    if (found.length === 0) throw new Error('Audius answered, but with nothing to play.')
    return true
  },

  async search({ query, page: pageNumber = 1 }) {
    const offset = (pageNumber - 1) * PAGE_SIZE
    return page(
      await getTracks(`/tracks/search?query=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`)
    )
  },

  async browse({ category, page: pageNumber = 1 }) {
    const time = category === 'all-time' ? 'allTime' : 'week'
    const offset = (pageNumber - 1) * PAGE_SIZE
    return page(await getTracks(`/tracks/trending?time=${time}&limit=${PAGE_SIZE}&offset=${offset}`))
  },

  async open({ id }): Promise<StreamAlbum> {
    const [track] = await getTracks(`/tracks/${encodeURIComponent(id)}`)
    if (!track?.title) throw new Error('That track is no longer on Audius.')
    if (track.is_streamable === false) throw new Error('Audius doesn’t allow streaming that track.')
    return {
      title: track.title,
      artist: track.user?.name,
      artwork: artworkOf(track),
      tracks: [
        {
          title: track.title,
          artist: track.user?.name,
          // Answers with a redirect to a content node that serves the file.
          url: `${API}/tracks/${encodeURIComponent(id)}/stream?app_name=${APP}`,
          duration: track.duration,
          mime: 'audio/mpeg',
          format: 'MP3'
        }
      ]
    }
  }
} satisfies StreamPlugin
