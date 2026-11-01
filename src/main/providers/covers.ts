// Covers for chart entries that came without one (e.g. a chart feed that only lists names), from the iTunes Search
// API: no key or account, and its images come from the Apple CDN the renderer already allows. Apple allows about 20
// lookups a minute, so past that a lookup is skipped (the card keeps its placeholder) rather than queued; what's
// found, and what's known to have no cover, is remembered for the session.

import { normalizeText } from '../../shared/fingerprint.ts'
import { fetchJson } from '../http.ts'
import type { ProviderAlbum } from './types.ts'

const ITUNES = 'https://itunes.apple.com/search'
const PER_MINUTE = 20
const CONCURRENCY = 4
const TIMEOUT_MS = 6000
const MAX_BYTES = 512 * 1024
const MAX_REMEMBERED = 2000
const COVER_SIZE = '600x600bb'

export interface CoverWanted {
  kind: 'album' | 'song'
  title: string
  artist: string
}

/** Finds a cover for one chart entry; undefined when there is none. Throws when the lookup itself failed. */
export type CoverLookup = (wanted: CoverWanted, signal?: AbortSignal) => Promise<string | undefined>

interface ItunesResult {
  artistName?: unknown
  trackName?: unknown
  collectionName?: unknown
  artworkUrl100?: unknown
}

/** The main artist of a credit like "Artist, Guest" or "Artist feat. Guest". */
const leadArtist = (credit: string) => normalizeText(credit.split(/,|&|\bfeat\.?|\bft\.?|\bwith\b/i)[0] ?? credit)

/** Same words, or one is the other plus extras ("Song" and "Song (feat. Guest)", "Album" and "Album - Single"). */
function sameName(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
}

/** The iTunes result for this entry, if one matches its artist and title. */
export function pickItunesCover(wanted: CoverWanted, results: unknown): string | undefined {
  if (!Array.isArray(results)) return undefined
  const title = normalizeText(wanted.title)
  const artist = leadArtist(wanted.artist)
  for (const result of results as ItunesResult[]) {
    const name = wanted.kind === 'song' ? result?.trackName : result?.collectionName
    if (typeof name !== 'string' || typeof result.artistName !== 'string') continue
    const credited = normalizeText(result.artistName)
    if (!sameName(normalizeText(name), title)) continue
    if (!artist || !` ${credited} `.includes(` ${artist} `)) continue
    const art = typeof result.artworkUrl100 === 'string' ? result.artworkUrl100 : ''
    if (!/^https:\/\/[a-z0-9-]+\.mzstatic\.com\//.test(art)) continue
    return art.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${COVER_SIZE}.$1`)
  }
  return undefined
}

/** Looks the entry up on iTunes (songs as songs, albums as albums). */
export const itunesCover: CoverLookup = async (wanted, signal) => {
  const url = new URL(ITUNES)
  url.search = new URLSearchParams({
    term: `${wanted.artist} ${wanted.title}`.slice(0, 200),
    media: 'music',
    entity: wanted.kind === 'song' ? 'song' : 'album',
    limit: '10'
  }).toString()
  const body = await fetchJson(url, {
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    allowHost: host => host === 'itunes.apple.com',
    signal
  })
  return pickItunesCover(wanted, (body as { results?: unknown } | null)?.results)
}

/** Fills in missing chart covers, within Apple's rate limit; remembers answers for the session. */
export class CoverFinder {
  private readonly known = new Map<string, string | null>()
  private lookups: number[] = []

  private readonly lookup: CoverLookup
  private readonly now: () => number

  constructor(lookup: CoverLookup = itunesCover, now: () => number = Date.now) {
    this.lookup = lookup
    this.now = now
  }

  /** The same entries, with a cover added where one was found. */
  async fill(albums: ProviderAlbum[], signal?: AbortSignal): Promise<ProviderAlbum[]> {
    const filled = [...albums]
    const missing = filled.flatMap((album, index) => (album.chart && album.artist && !album.artwork ? [index] : []))
    let next = 0
    const worker = async () => {
      while (next < missing.length && !signal?.aborted) {
        const index = missing[next++]
        const album = filled[index]
        const artwork = await this.find(
          { kind: album.chart ?? 'album', title: album.title, artist: album.artist ?? '' },
          signal
        )
        if (artwork) filled[index] = { ...album, artwork }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker))
    return filled
  }

  /** One entry's cover: remembered if already looked up, otherwise asked for (when the rate limit allows). */
  async find(wanted: CoverWanted, signal?: AbortSignal): Promise<string | undefined> {
    const key = `${wanted.kind}\n${normalizeText(wanted.artist)}\n${normalizeText(wanted.title)}`
    const known = this.known.get(key)
    if (known !== undefined) return known ?? undefined
    if (!this.takeLookup()) return undefined
    try {
      const artwork = await this.lookup(wanted, signal)
      this.remember(key, artwork ?? null)
      return artwork
    } catch {
      // Network trouble, not a missing cover: ask again next time.
      return undefined
    }
  }

  private takeLookup(): boolean {
    const now = this.now()
    this.lookups = this.lookups.filter(at => now - at < 60_000)
    if (this.lookups.length >= PER_MINUTE) return false
    this.lookups.push(now)
    return true
  }

  private remember(key: string, artwork: string | null): void {
    this.known.set(key, artwork)
    if (this.known.size > MAX_REMEMBERED) {
      const oldest = this.known.keys().next().value
      if (oldest !== undefined) this.known.delete(oldest)
    }
  }
}
