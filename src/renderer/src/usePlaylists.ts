import { useCallback, useEffect, useState } from 'react'
import type { Playlist, SongRef } from '../../shared/types'

/** The user's playlists; every change goes through the main process and comes back as the saved list. */
export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  useEffect(() => {
    void window.chomusuke.getPlaylists().then(setPlaylists)
  }, [])

  /** Returns the new playlist's id, or an error message. */
  const create = useCallback(async (name: string): Promise<{ id?: string; error?: string }> => {
    const result = await window.chomusuke.createPlaylist(name)
    setPlaylists(result.playlists)
    return { id: result.id, error: result.error }
  }, [])

  const run = useCallback(async (call: Promise<Playlist[]>) => setPlaylists(await call), [])

  return {
    playlists,
    create,
    rename: (id: string, name: string) => run(window.chomusuke.renamePlaylist(id, name)),
    remove: (id: string) => run(window.chomusuke.deletePlaylist(id)),
    addTrack: (id: string, infoHash: string, key: string) => run(window.chomusuke.addToPlaylist(id, infoHash, key)),
    addSongs: (id: string, songs: SongRef[]) => run(window.chomusuke.addSongsToPlaylist(id, songs)),
    removeSong: (id: string, songId: string) => run(window.chomusuke.removeFromPlaylist(id, songId)),
    move: (id: string, from: number, to: number) => run(window.chomusuke.moveInPlaylist(id, from, to)),
    reload: () => run(window.chomusuke.getPlaylists())
  }
}

export type Playlists = ReturnType<typeof usePlaylists>
