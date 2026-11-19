import { useSyncExternalStore } from 'react'

/**
 * Where playback is. It changes about four times a second while playing, so it's kept out of the player's React state
 * (which the whole app re-renders on) and only the components that show it subscribe, with {@link usePlaybackTime}.
 */
export interface PlaybackTime {
  /** Seconds */
  currentTime: number
  /** Seconds buffered from the start, up to where the buffered part around the playhead ends */
  bufferedEnd: number
}

export interface PlaybackClock {
  get(): PlaybackTime
  /** Listeners are only told when something changed. */
  set(next: PlaybackTime): void
  subscribe(listener: () => void): () => void
}

export function createPlaybackClock(): PlaybackClock {
  let value: PlaybackTime = { currentTime: 0, bufferedEnd: 0 }
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (next.currentTime === value.currentTime && next.bufferedEnd === value.bufferedEnd) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** The playback time; re-renders the calling component, and only it, when the time changes. */
export function usePlaybackTime(clock: PlaybackClock): PlaybackTime {
  return useSyncExternalStore(clock.subscribe, clock.get)
}
