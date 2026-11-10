import { useCallback, useEffect, useState } from 'react'
import type { Album, Lyrics, Track } from '../../shared/types'

export type LyricsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; lyrics: Lyrics | null }
  | { status: 'error'; error: string }

/**
 * The lyrics of the track that's playing, looked up while `enabled` (the lyrics panel is open) and again whenever
 * the track changes. The main process remembers answers, so going back to a song doesn't ask the service again.
 */
export function useLyrics(
  track: Track | null | undefined,
  album: Album | null,
  enabled: boolean
): [state: LyricsState, retry: () => void] {
  const [state, setState] = useState<LyricsState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const trackId = track?.id

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new track (or a retry) is the only reason to ask again
  useEffect(() => {
    if (!enabled || !track) return setState({ status: 'idle' })
    let current = true
    setState({ status: 'loading' })
    void window.chomusuke
      .getLyrics({
        title: track.title,
        artist: track.artist ?? album?.artist,
        album: album?.title,
        duration: track.duration
      })
      .then(response => {
        if (!current) return
        setState(
          response.ok ? { status: 'ready', lyrics: response.lyrics } : { status: 'error', error: response.error }
        )
      })
    return () => {
      current = false
    }
  }, [enabled, trackId, attempt])

  return [state, useCallback(() => setAttempt(n => n + 1), [])]
}

/** The line being sung: the last one that has started (a little early, since the clock is only read ~4×/s). */
export function activeLine(lyrics: Lyrics, time: number): number {
  if (!lyrics.synced) return -1
  let active = -1
  for (const [index, line] of lyrics.lines.entries()) {
    if ((line.time ?? Number.POSITIVE_INFINITY) <= time + 0.25) active = index
    else break
  }
  return active
}
