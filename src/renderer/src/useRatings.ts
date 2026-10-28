import { useCallback, useEffect, useMemo, useState } from 'react'
import { songFingerprint, songId } from '../../shared/fingerprint'
import type { RatedSong, Track } from '../../shared/types'

export interface TrackRating {
  rating: 1 | -1 | 0
  /** Rated on this exact file (false: matched the same song in another torrent) */
  exact: boolean
}

/** Liked/disliked songs, looked up by exact file first and then by artist + title across torrents. */
export function useRatings() {
  const [songs, setSongs] = useState<RatedSong[]>([])

  useEffect(() => {
    void window.chomusuke.getRatings().then(setSongs)
  }, [])

  const { byId, byFingerprint } = useMemo(() => {
    const byId = new Map<string, RatedSong>()
    const byFingerprint = new Map<string, RatedSong>()
    // Newest first, so the latest rating of a song wins when it appears in several torrents.
    for (const song of songs) {
      byId.set(song.id, song)
      if (song.fingerprint && !byFingerprint.has(song.fingerprint)) byFingerprint.set(song.fingerprint, song)
    }
    return { byId, byFingerprint }
  }, [songs])

  const ratingOf = useCallback(
    (infoHash: string, track: Pick<Track, 'key' | 'title' | 'artist'>): TrackRating => {
      const exact = byId.get(songId(infoHash, track.key))
      if (exact) return { rating: exact.rating, exact: true }
      const fingerprint = songFingerprint(track.title, track.artist)
      const similar = fingerprint ? byFingerprint.get(fingerprint) : undefined
      return { rating: similar?.rating ?? 0, exact: false }
    },
    [byId, byFingerprint]
  )

  const rate = useCallback(async (infoHash: string, key: string, rating: 0 | 1 | -1) => {
    setSongs(await window.chomusuke.rateTrack(infoHash, key, rating))
  }, [])

  const reload = useCallback(async () => setSongs(await window.chomusuke.getRatings()), [])

  return { songs, ratingOf, rate, reload }
}

export type Ratings = ReturnType<typeof useRatings>
