import { useEffect } from 'react'
import type { Player } from './usePlayer'

/** Tells the app what's playing, for the Discord status (the main process decides whether to show it). */
export function useNowPlaying({ audio, state, track }: Player): void {
  const { album, isPlaying, duration } = state
  useEffect(() => {
    const send = () => {
      void window.chomusuke.setNowPlaying(
        track && album
          ? {
              title: track.title,
              artist: track.artist ?? album.artist,
              album: album.title,
              coverUrl: album.coverUrl,
              playing: isPlaying,
              position: audio.currentTime,
              duration: duration || track.duration || 0
            }
          : null
      )
    }
    send()
    // A seek moves the progress bar; nothing else about the song changes.
    audio.addEventListener('seeked', send)
    return () => audio.removeEventListener('seeked', send)
  }, [audio, track, album, isPlaying, duration])
}
