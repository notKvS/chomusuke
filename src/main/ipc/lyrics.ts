import { app } from 'electron'
import type { LyricsQuery, LyricsResponse } from '../../shared/types.ts'
import { fetchJson } from '../http.ts'
import { logger } from '../log.ts'
import { LYRICS_HOST, LyricsFinder } from '../lyrics.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const log = logger('lyrics')

const MAX_TEXT = 300
const LYRICS_MAX_BYTES = 2 * 1024 * 1024
const LYRICS_TIMEOUT_MS = 10_000

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value
        .replace(/\p{Cc}+/gu, ' ')
        .trim()
        .slice(0, MAX_TEXT)
    : undefined

/** What the player window sends is only ever words to search for: cleaned and capped here. */
function sanitizeQuery(raw: unknown): LyricsQuery | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { title, artist, album, duration } = raw as Record<string, unknown>
  const cleanTitle = text(title)
  if (!cleanTitle) return undefined
  return {
    title: cleanTitle,
    artist: text(artist),
    album: text(album),
    duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined
  }
}

/** Lyrics for the song that's playing, from LRCLIB. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender } = deps
  // LRCLIB asks apps to say who they are.
  const headers = { 'User-Agent': `Chomusuke/${app.getVersion()} (https://github.com/notKvS/chomusuke)` }
  const finder = new LyricsFinder((url, signal) =>
    fetchJson(url, {
      maxBytes: LYRICS_MAX_BYTES,
      timeoutMs: LYRICS_TIMEOUT_MS,
      allowHost: host => host === LYRICS_HOST,
      headers,
      signal
    })
  )

  handle('lyrics:get', async (event, rawQuery: unknown): Promise<LyricsResponse> => {
    assertTrustedSender(event)
    const query = sanitizeQuery(rawQuery)
    if (!query) return { ok: false, error: 'That song has no title to look up.' }
    try {
      return { ok: true, lyrics: await finder.find(query) }
    } catch (err) {
      log.warn(`couldn’t look up “${query.title}”:`, err)
      return { ok: false, error: 'Couldn’t reach the lyrics service. Try again in a moment.' }
    }
  })
}
