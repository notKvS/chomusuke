import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Album, Track } from '../../shared/types'
import { log } from './log'
import { createPlaybackClock } from './playbackTime'

export interface PlayerState {
  album: Album | null
  index: number
  isPlaying: boolean
  isBuffering: boolean
  duration: number
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
/**
 * `shouldSkip` (e.g. disliked songs) is honoured when the queue moves on by itself or with Next; a track the user
 * picks explicitly always plays.
 */
/**
 * `onEdge` is asked to continue past the end (1) or before the start (-1) of the current album — e.g. to move on in a
 * playlist that spans several torrents. It returns true when it took over.
 */
/**
 * `onBeforeNext` is asked first whenever playback moves on (the track ended, or Next), before the next track of the
 * album: songs queued to play next go ahead of the album. It returns true when it took over.
 */
export function usePlayer(
  onError: (message: string) => void,
  shouldSkip: (track: Track) => boolean = () => false,
  onEdge: (direction: 1 | -1) => boolean = () => false,
  onBeforeNext: () => boolean = () => false
) {
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
    duration: 0,
    volume: audio.volume,
    muted: false
  }))
  const [durations, setDurations] = useState<Record<string, number>>({})
  // The playback time changes ~4×/s: kept outside `state` so only what shows it re-renders (see usePlaybackTime).
  const time = useMemo(createPlaybackClock, [])

  // Event handlers need the latest queue without re-subscribing.
  const queueRef = useRef<{ album: Album | null; index: number }>({ album: null, index: -1 })
  const lastDataAt = useRef(0)
  const onErrorRef = useRef(onError)
  const skipRef = useRef(shouldSkip)
  const edgeRef = useRef(onEdge)
  const beforeNextRef = useRef(onBeforeNext)
  useEffect(() => {
    onErrorRef.current = onError
    skipRef.current = shouldSkip
    edgeRef.current = onEdge
    beforeNextRef.current = onBeforeNext
  }, [onError, shouldSkip, onEdge, onBeforeNext])

  /** The next playable index after `index`, skipping what the user doesn't want to hear. */
  const nextIndex = useCallback((album: Album, index: number): number | undefined => {
    for (let i = index + 1; i < album.tracks.length; i++) if (!skipRef.current(album.tracks[i])) return i
    return undefined
  }, [])

  // Audio events repeat themselves (canplay, progress…): an update that changes nothing keeps the same state.
  const patch = useCallback(
    (next: Partial<PlayerState>) =>
      setState(prev =>
        Object.entries(next).every(([key, value]) => prev[key as keyof PlayerState] === value)
          ? prev
          : { ...prev, ...next }
      ),
    []
  )

  const playAt = useCallback(
    (album: Album, index: number) => {
      const track = album.tracks[index]
      if (!track) return
      queueRef.current = { album, index }
      log.info(`playing “${track.title}” (${track.id}) from “${album.title}”`)
      patch({ album, index, duration: 0, isBuffering: true })
      time.set({ currentTime: 0, bufferedEnd: 0 })
      audio.src = track.url
      audio.play().catch((err: unknown) => {
        // Switching tracks quickly aborts the previous play() — that's expected.
        if (err instanceof DOMException && err.name === 'AbortError') return
        log.warn(`play() failed for ${track.id}:`, err)
      })
    },
    [audio, patch, time]
  )

  /** Plays the track after `index` of `album`, skipping what shouldn't play; false when there's none. */
  const playAfter = useCallback(
    (album: Album, index: number): boolean => {
      const target = nextIndex(album, index)
      if (target === undefined) return false
      playAt(album, target)
      return true
    },
    [playAt, nextIndex]
  )

  /** Moves on from the current track: queued songs first, then the album, then `onEdge`. False when nothing's left. */
  const advance = useCallback((): boolean => {
    if (beforeNextRef.current()) return true
    const { album, index } = queueRef.current
    return (album !== null && playAfter(album, index)) || edgeRef.current(1)
  }, [playAfter])

  const next = useCallback(() => void advance(), [advance])

  const prev = useCallback(() => {
    const { album, index } = queueRef.current
    if (!album) return
    if (audio.currentTime > RESTART_THRESHOLD_S) audio.currentTime = 0
    else if (index > 0) playAt(album, index - 1)
    else if (!edgeRef.current(-1)) audio.currentTime = 0
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
      timeupdate: () => time.set({ currentTime: audio.currentTime, bufferedEnd: bufferedAhead(audio) }),
      progress: () => {
        lastDataAt.current = Date.now()
        time.set({ ...time.get(), bufferedEnd: bufferedAhead(audio) })
      },
      durationchange: () => {
        const track = current()
        if (!Number.isFinite(audio.duration)) return
        patch({ duration: audio.duration })
        if (track) setDurations(prev => ({ ...prev, [track.id]: audio.duration }))
      },
      volumechange: () => patch({ volume: audio.volume, muted: audio.muted }),
      ended: () => {
        if (!advance()) patch({ isPlaying: false })
      },
      error: () => {
        if (!audio.src) return
        patch({ isPlaying: false, isBuffering: false })
        const title = current()?.title ?? 'this track'
        log.error(`audio error on ${current()?.id}: code ${audio.error?.code}`, audio.error?.message ?? '')
        const why =
          queueRef.current.album?.source === 'http'
            ? 'its source isn’t sending the audio right now'
            : 'no peers are sharing it right now'
        onErrorRef.current(`Couldn't play “${title}”. The format may be unsupported, or ${why}.`)
      }
    }
    for (const [name, handler] of Object.entries(handlers)) audio.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(handlers)) audio.removeEventListener(name, handler)
    }
  }, [audio, patch, advance, time])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new track restarts the stall timer
  useEffect(() => {
    if (!state.isBuffering) return
    const since = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - Math.max(since, lastDataAt.current) < STALL_MS) return
      clearInterval(timer)
      const track = queueRef.current.album?.tracks[queueRef.current.index]
      const title = track?.title ?? 'This track'
      log.warn(`stalled: no data for ${STALL_MS / 1000} s on ${track?.id}, buffered to ${bufferedAhead(audio)} s`)
      const why =
        queueRef.current.album?.source === 'http'
          ? 'its source has stopped sending the audio'
          : 'no peer is sharing that part of the torrent'
      onErrorRef.current(`“${title}” is stuck — ${why} right now.`)
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

  return { audio, state, time, track, durations, playAt, playAfter, toggle, next, prev, seek, setVolume, toggleMute }
}

export type Player = ReturnType<typeof usePlayer>
