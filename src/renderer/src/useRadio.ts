import { useCallback, useRef } from 'react'
import type { Album, PlayedSong } from '../../shared/types'

const RADIO_KEY = 'chomusuke.radio'

/** Whether similar songs play on when the music runs out: on unless turned off in Settings. */
export function radioEnabled(): boolean {
  try {
    return localStorage.getItem(RADIO_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setRadioEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(RADIO_KEY, enabled ? 'on' : 'off')
  } catch {
    // Not remembered: it stays as it was next launch.
  }
}

/**
 * Keeps the music going when an album or a queue ends: finds a song by an artist like the one that just played and
 * plays it on its own, like a queue song, so the next one ending carries on from there. Its torrent loads in the
 * background (no page change); if anything else starts playing meanwhile, that wins.
 */
export function useRadio({
  playAt,
  addAlbum,
  setToast,
  playing
}: {
  playAt: (album: Album, index: number) => void
  /** Called with each album loaded for the radio, so it shows in the sidebar. */
  addAlbum: (album: Album) => void
  setToast: (message: string) => void
  /** What the player has now. */
  playing: () => { album: Album | null; index: number }
}) {
  const load = useRef(0)
  // The album the radio played last: the toast only says it's taking over the first time.
  const lastPlayed = useRef<Album | null>(null)

  /** Starts finding a song like `ended`; false when the radio is off or there's no artist to go on. */
  const start = useCallback(
    (ended: PlayedSong): boolean => {
      if (!ended.artist || !radioEnabled()) return false
      const id = ++load.current
      const before = playing()
      const stale = () => {
        const now = playing()
        return id !== load.current || now.album !== before.album || now.index !== before.index
      }
      if (before.album !== lastPlayed.current) setToast(`Playing on with songs like ${ended.artist}…`)

      void (async () => {
        const candidates = await window.chomusuke.getRadioSongs(ended)
        for (const candidate of candidates) {
          if (stale()) return
          const result = await window.chomusuke.openResult(candidate.id)
          if (stale()) return
          const track = result.ok ? result.album.tracks.find(t => t.key === result.startKey) : undefined
          if (!result.ok || !track) continue
          const album = { ...result.album, tracks: [track] }
          addAlbum(result.album)
          lastPlayed.current = album
          playAt(album, 0)
          return
        }
        if (!stale()) {
          setToast(
            candidates.length > 0
              ? 'Couldn’t find a similar song on your plugins.'
              : `No similar songs to play after ${ended.artist}.`
          )
        }
      })()
      return true
    },
    [playAt, addAlbum, setToast, playing]
  )

  return { start }
}
