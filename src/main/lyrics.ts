import { normalizeText, songFingerprint, stripReleaseInfo } from '../shared/fingerprint.ts'
import type { LyricLine, Lyrics, LyricsQuery } from '../shared/types.ts'
import { logger } from './log.ts'

const log = logger('lyrics')

export const LYRICS_HOST = 'lrclib.net'
const SOURCE = 'LRCLIB'
const MAX_CACHED = 300
/** Synced lyrics from a recording of about this length (seconds) line up with ours; further off they'd drift. */
const SYNC_TOLERANCE_S = 5

/** GETs and parses JSON from the lyrics service; injected so the matching logic is testable offline. */
export type LyricsFetcher = (url: URL, signal?: AbortSignal) => Promise<unknown>

/** One song as LRCLIB (https://lrclib.net/docs) returns it. */
interface LrclibRecord {
  trackName?: string
  artistName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const isRecord = (value: unknown): value is LrclibRecord => typeof value === 'object' && value !== null

/**
 * The lines of an LRC file: `[mm:ss.xx] words`, with several stamps for a repeated line, an optional `[offset:ms]`
 * (positive = lyrics come earlier), and tags such as `[ar:…]` that are left out. Lines come back in time order.
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  let offset = 0
  for (const raw of text.split(/\r?\n/)) {
    const tag = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw)
    if (tag) {
      offset = Number(tag[1]) / 1000
      continue
    }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue
    // Word-by-word stamps (<00:12.40>) and any other tags are not part of the words.
    const words = raw
      .replace(/\[[^\]]*\]|<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    for (const [, minutes, seconds, fraction] of stamps) {
      const time = Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0)
      lines.push({ time: Math.max(0, time - offset), text: words })
    }
  }
  return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
}

const plainLines = (text: string): LyricLine[] =>
  text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map(line => ({ text: line.trim() }))

/** The synced text with its stamps removed, for when it's the only text a matching record has. */
const withoutStamps = (synced: string): string =>
  synced
    .split(/\r?\n/)
    .filter(line => /^\s*\[\d{1,3}:\d{2}/.test(line))
    .map(line => line.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim())
    .join('\n')

/** The records that are the wanted song: the same artist and title as the track says (not just similar). */
function sameSong(records: LrclibRecord[], query: LyricsQuery): LrclibRecord[] {
  const wanted = songFingerprint(query.title, query.artist)
  return records.filter(r => {
    if (!r.trackName) return false
    if (!r.artistName || !query.artist) {
      return normalizeText(stripReleaseInfo(r.trackName)) === normalizeText(stripReleaseInfo(query.title))
    }
    return songFingerprint(r.trackName, r.artistName) === wanted
  })
}

const gap = (record: LrclibRecord, query: LyricsQuery): number =>
  query.duration && record.duration ? Math.abs(record.duration - query.duration) : 0

/**
 * The lyrics to show for a song among LRCLIB's records for it: synced ones for a recording of about the same length
 * first (closest wins), then any record with words, shown plain.
 */
export function chooseLyrics(records: unknown[], query: LyricsQuery): Lyrics | null {
  const matching = sameSong(records.filter(isRecord), query)
  const fits = (r: LrclibRecord) => gap(r, query) <= SYNC_TOLERANCE_S
  const synced = matching.filter(r => r.syncedLyrics && fits(r)).sort((a, b) => gap(a, query) - gap(b, query))[0]
  if (synced?.syncedLyrics) {
    const lines = parseLrc(synced.syncedLyrics)
    if (lines.length > 0) return { lines, synced: true, instrumental: false, source: SOURCE }
  }
  const withWords = matching
    .filter(r => r.plainLyrics || r.syncedLyrics)
    .sort((a, b) => gap(a, query) - gap(b, query))[0]
  const words = withWords?.plainLyrics || (withWords?.syncedLyrics ? withoutStamps(withWords.syncedLyrics) : '')
  if (words.trim()) return { lines: plainLines(words), synced: false, instrumental: false, source: SOURCE }
  if (matching.some(r => r.instrumental)) return { lines: [], synced: false, instrumental: true, source: SOURCE }
  return null
}

/**
 * Finds the words of a song on LRCLIB, a free community database (synced and plain lyrics, no key). Answers are kept for
 * the session, including "no lyrics", so skipping back to a song doesn't ask again. A failing request isn't kept.
 */
export class LyricsFinder {
  private readonly fetcher: LyricsFetcher
  private readonly cache = new Map<string, Lyrics | null>()

  constructor(fetcher: LyricsFetcher) {
    this.fetcher = fetcher
  }

  /** The lyrics, or null when there are none; throws when the service can't be reached. */
  async find(query: LyricsQuery, signal?: AbortSignal): Promise<Lyrics | null> {
    // Too generic to know which song it is ("Track 01"): nothing to look up.
    if (!songFingerprint(query.title, query.artist)) return null
    // The title as a search wants it: no track number or edition tags.
    const title = stripReleaseInfo(query.title)
      .replace(/^\s*\d{1,3}\s*[.)-]\s*/, '')
      .trim()
    const key = `${normalizeText(title)}|${normalizeText(query.artist ?? '')}|${Math.round((query.duration ?? 0) / 5)}`
    if (this.cache.has(key)) return this.cache.get(key) ?? null

    const searches = query.artist
      ? [
          new URLSearchParams({ track_name: title, artist_name: query.artist }),
          new URLSearchParams({ q: `${query.artist} ${title}` })
        ]
      : [new URLSearchParams({ q: title })]
    let lyrics: Lyrics | null = null
    for (const params of searches) {
      const url = new URL(`https://${LYRICS_HOST}/api/search`)
      url.search = params.toString()
      const records = await this.fetcher(url, signal)
      lyrics = chooseLyrics(Array.isArray(records) ? records : [], query)
      if (lyrics) break
    }
    log.info(
      `“${query.title}” by ${query.artist ?? 'unknown'}: ${lyrics ? (lyrics.synced ? 'synced' : 'plain') : 'no'} lyrics`
    )
    this.cache.set(key, lyrics)
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string)
    return lyrics
  }
}
