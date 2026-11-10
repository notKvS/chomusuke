// JioSaavn: a large streaming catalogue (Hindi, Punjabi, Tamil, English and more). Its web player gets each song's
// address from an API as an encrypted string; the decryption key is the one the web player ships with.
import forge from 'node-forge'
import type { Paged, StreamAlbum, StreamPlugin, StreamResult } from './sdk'

const API = 'https://www.jiosaavn.com/api.php'
const DES_KEY = '38346591'
const PAGE_SIZE = 20
const QUERY = '_format=json&_marker=0&api_version=4&ctx=web6dot0'

interface SaavnSong {
  id?: string
  title?: string
  subtitle?: string
  image?: string
  year?: string
  more_info?: {
    album?: string
    duration?: string
    encrypted_media_url?: string
    '320kbps'?: string
    artistMap?: { primary_artists?: Array<{ name?: string }> }
  }
}

/** The API sends titles with HTML entities ("Tom &amp; Jerry", "&quot;Hello&quot;"). */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return named[String(name).toLowerCase()] ?? whole
  })
}

/** Turns a song's encrypted media string (base64, single DES in ECB mode) into its address. */
export function decryptMediaUrl(encrypted: string): string {
  const decipher = forge.cipher.createDecipher('DES-ECB', forge.util.createBuffer(DES_KEY))
  decipher.start()
  decipher.update(forge.util.createBuffer(forge.util.decode64(encrypted)))
  if (!decipher.finish()) throw new Error('JioSaavn’s address for that song couldn’t be read.')
  return decipher.output.getBytes()
}

/** The address comes at 96 kbps; the same file exists at higher rates under another suffix. */
export function withBitrate(url: string, kbps: 160 | 320): string {
  return url.replace(/_(?:12|48|96|160|320)\.mp4$/, `_${kbps}.mp4`)
}

const names = (song: SaavnSong): string | undefined => {
  const list = song.more_info?.artistMap?.primary_artists?.map(a => a.name).filter(Boolean)
  const joined = list?.length ? list.join(', ') : song.subtitle?.split(' - ')[0]
  return joined ? decodeEntities(joined) : undefined
}

const bigger = (image?: string): string | undefined => image?.replace(/-(?:50x50|150x150)\./, '-500x500.')

export function toResult(song: SaavnSong): StreamResult | undefined {
  if (!song.id || !song.title || !song.more_info?.encrypted_media_url) return undefined
  return {
    id: song.id,
    title: decodeEntities(song.title),
    artist: names(song),
    year: /^\d{4}$/.test(song.year ?? '') ? song.year : undefined,
    artwork: bigger(song.image)
  }
}

async function call(params: string): Promise<unknown> {
  const res = await fetch(`${API}?${params}&${QUERY}`)
  if (!res.ok) throw new Error(`JioSaavn answered with an error (${res.status}).`)
  return res.json()
}

export const songsOf = (body: unknown): SaavnSong[] => {
  const b = body as { results?: SaavnSong[]; data?: SaavnSong[]; songs?: SaavnSong[] } | null
  return b?.results ?? b?.data ?? b?.songs ?? []
}

export const detailsOf = (body: unknown, id: string): SaavnSong | undefined => {
  const b = body as Record<string, unknown> | null
  const listed = songsOf(body)[0]
  if (listed) return listed
  const keyed = b?.[id]
  return keyed && typeof keyed === 'object' ? (keyed as SaavnSong) : undefined
}

function page(songs: SaavnSong[]): Paged<StreamResult> {
  return {
    results: songs.map(toResult).filter((r): r is StreamResult => r !== undefined),
    hasMore: songs.length >= PAGE_SIZE
  }
}

export default {
  async test() {
    if (songsOf(await call(`__call=search.getResults&q=arijit&p=1&n=1`)).length === 0) {
      throw new Error('JioSaavn answered, but with nothing to play.')
    }
    return true
  },

  async search({ query, page: pageNumber = 1 }) {
    return page(
      songsOf(await call(`__call=search.getResults&q=${encodeURIComponent(query)}&p=${pageNumber}&n=${PAGE_SIZE}`))
    )
  },

  async open({ id }): Promise<StreamAlbum> {
    const song = detailsOf(await call(`__call=song.getDetails&pids=${encodeURIComponent(id)}`), id)
    const encrypted = song?.more_info?.encrypted_media_url
    if (!song?.title || !encrypted) throw new Error('JioSaavn has no audio for that song.')
    const url = withBitrate(decryptMediaUrl(encrypted), song.more_info?.['320kbps'] === 'true' ? 320 : 160)
    const duration = Number(song.more_info?.duration)
    const artist = names(song)
    return {
      title: decodeEntities(song.title),
      artist,
      artwork: bigger(song.image),
      tracks: [
        {
          title: decodeEntities(song.title),
          artist,
          url,
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          mime: 'audio/mp4',
          format: 'AAC'
        }
      ]
    }
  }
} satisfies StreamPlugin
