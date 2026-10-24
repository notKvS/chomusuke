import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Album, Track } from '../../shared/types'

export interface PlayerState {
  album: Album | null
  index: number
  isPlaying: boolean
  isBuffering: boolean
  currentTime: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
}

const VOLUME_KEY = 'chomusuke.volume'
const RESTART_THRESHOLD_S = 3
/** Buffering with no new data for this long means the swarm can't supply the next pieces. */
const STALL_MS = 30_000

function savedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    const value = raw === null ? NaN : Number(raw)
    return value >= 0 && value <= 1 ? value : 0.8
  } catch {
    return 0.8
  }
}

function bufferedAhead(audio: HTMLAudioElement): number {
  const { buffered, currentTime } = audio
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) return buffered.end(i)
  }
  return currentTime
}

/** A single <audio> element driven like a queue over one album's tracks. */
export function usePlayer(onError: (message: string) => void) {
  const audio = useMemo(() => {
    const element = new Audio()
    element.preload = 'auto'
    element.volume = savedVolume()
    return element
  }, [])

  const [state, setState] = useState<PlayerState>(() => ({
    album: null,
    index: -1,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    volume: audio.volume,
    muted: false
  }))
  const [durations, setDurations] = useState<Record<string, number>>({})

  // Event handlers need the latest queue without re-subscribing.
  const queueRef = useRef<{ album: Album | null; index: number }>({ album: null, index: -1 })
  const lastDataAt = useRef(0)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const patch = useCallback((next: Partial<PlayerState>) => setState(prev => ({ ...prev, ...next })), [])

  const playAt = useCallback(
    (album: Album, index: number) => {
      const track = album.tracks[index]
      if (!track) return
      queueRef.current = { album, index }
      patch({ album, index, currentTime: 0, duration: 0, bufferedEnd: 0, isBuffering: true })
      audio.src = track.url
      audio.play().catch((err: unknown) => {
        // Switching tracks quickly aborts the previous play() — that's expected.
        if (err instanceof DOMException && err.name === 'AbortError') return
      })
    },
    [audio, patch]
  )

  const next = useCallback(() => {
    const { album, index } = queueRef.current
    if (album && index + 1 < album.tracks.length) playAt(album, index + 1)
  }, [playAt])

  const prev = useCallback(() => {
    const { album, index } = queueRef.current
    if (!album) return
    if (audio.currentTime > RESTART_THRESHOLD_S || index === 0) audio.currentTime = 0
    else playAt(album, index - 1)
  }, [audio, playAt])

  const toggle = useCallback(() => {
    if (!audio.src) return
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  }, [audio])

  const seek = useCallback(
    (time: number) => {
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(Math.max(time, 0), audio.duration)
    },
    [audio]
  )

  const setVolume = useCallback(
    (volume: number) => {
      audio.volume = Math.min(Math.max(volume, 0), 1)
      audio.muted = false
      try {
        localStorage.setItem(VOLUME_KEY, String(audio.volume))
      } catch {
        // Persisting volume is a convenience only.
      }
    },
    [audio]
  )

  const toggleMute = useCallback(() => {
    audio.muted = !audio.muted
  }, [audio])

  useEffect(() => {
    const current = (): Track | undefined => queueRef.current.album?.tracks[queueRef.current.index]
    const handlers: Record<string, () => void> = {
      playing: () => patch({ isPlaying: true, isBuffering: false }),
      pause: () => patch({ isPlaying: false }),
      waiting: () => patch({ isBuffering: true }),
      canplay: () => patch({ isBuffering: false }),
      timeupdate: () => patch({ currentTime: audio.currentTime, bufferedEnd: bufferedAhead(audio) }),
      progress: () => {
        lastDataAt.current = Date.now()
        patch({ bufferedEnd: bufferedAhead(audio) })
      },
      durationchange: () => {
        const track = current()
        if (!Number.isFinite(audio.duration)) return
        patch({ duration: audio.duration })
        if (track) setDurations(prev => ({ ...prev, [track.id]: audio.duration }))
      },
      volumechange: () => patch({ volume: audio.volume, muted: audio.muted }),
      ended: () => {
        const { album, index } = queueRef.current
        if (album && index + 1 < album.tracks.length) playAt(album, index + 1)
        else patch({ isPlaying: false })
      },
      error: () => {
        if (!audio.src) return
        patch({ isPlaying: false, isBuffering: false })
        const title = current()?.title ?? 'this track'
        onErrorRef.current(`Couldn't play “${title}”. The format may be unsupported, or no peers are sharing it right now.`)
      }
    }
    for (const [name, handler] of Object.entries(handlers)) audio.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(handlers)) audio.removeEventListener(name, handler)
    }
  }, [audio, patch, playAt])

  useEffect(() => {
    if (!state.isBuffering) return
    const since = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - Math.max(since, lastDataAt.current) < STALL_MS) return
      clearInterval(timer)
      const title = queueRef.current.album?.tracks[queueRef.current.index]?.title ?? 'This track'
      onErrorRef.current(`“${title}” is stuck — no peer is sharing that part of the torrent right now.`)
    }, 2000)
    return () => clearInterval(timer)
  }, [state.isBuffering, state.index])

  // OS media controls (media keys, Windows media flyout).
  useEffect(() => {
    const session = navigator.mediaSession
    session.setActionHandler('play', toggle)
    session.setActionHandler('pause', toggle)
    session.setActionHandler('nexttrack', next)
    session.setActionHandler('previoustrack', prev)
    session.setActionHandler('seekto', details => details.seekTime !== undefined && seek(details.seekTime))
  }, [toggle, next, prev, seek])

  const track = state.album?.tracks[state.index] ?? null
  useEffect(() => {
    if (!track || !state.album) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? '',
      album: state.album.title,
      artwork: state.album.coverUrl ? [{ src: state.album.coverUrl }] : []
    })
  }, [track, state.album])

  useEffect(() => () => audio.pause(), [audio])

  return { audio, state, track, durations, playAt, toggle, next, prev, seek, setVolume, toggleMute }
}

export type Player = ReturnType<typeof usePlayer>
