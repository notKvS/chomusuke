import { useEffect, useRef } from 'react'
import type { PlayedSong } from '../../shared/types'
import type { Player } from './usePlayer'

/** Seconds of a song that count as having listened to it (half of it, for a short one). */
const LISTENED_S = 30

/** Remembers each song you actually listen to, for Home's suggestions. Skipping through songs doesn't count. */
export function usePlayHistory({ audio, state, track }: Player): void {
  const song = useRef<PlayedSong | null>(null)
  song.current = track
    ? { title: track.title, artist: track.artist ?? state.album?.artist, album: state.album?.title }
    : null
  const id = track?.id

  useEffect(() => {
    if (id === undefined) return
    let listened = 0
    let last = audio.currentTime
    let recorded = false
    const onTime = () => {
      const moved = audio.currentTime - last
      last = audio.currentTime
      // Only steady playback counts: a seek is a jump, not listening.
      if (!audio.paused && moved > 0 && moved < 2) listened += moved
      const needed = Math.min(LISTENED_S, (Number.isFinite(audio.duration) ? audio.duration : 60) / 2)
      if (!recorded && listened >= needed && song.current) {
        recorded = true
        void window.chomusuke.recordPlay(song.current)
      }
    }
    const onSeek = () => {
      last = audio.currentTime
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('seeked', onSeek)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('seeked', onSeek)
    }
  }, [audio, id])
}
