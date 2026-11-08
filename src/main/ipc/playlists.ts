import type { Playlist } from '../../shared/types.ts'
import { logger } from '../log.ts'
import { PlaylistError } from '../playlists.ts'
import { isInfoHash } from '../seeding.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const log = logger('playlists')

/** User playlists. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, playlists } = deps
  // Playlists: every handler answers with the full list, so the UI always shows what's saved.
  const playlistCall = (work: () => Promise<unknown>) => async (): Promise<Playlist[]> => {
    try {
      await work()
    } catch (err) {
      if (!(err instanceof PlaylistError)) log.error(err)
    }
    return playlists.list()
  }

  handle('playlists:list', (event): Playlist[] => {
    assertTrustedSender(event)
    return playlists.list()
  })

  handle('playlists:create', async (event, name: unknown) => {
    assertTrustedSender(event)
    try {
      const playlist = await playlists.create(name)
      return { playlists: playlists.list(), id: playlist.id }
    } catch (err) {
      return { playlists: playlists.list(), error: err instanceof PlaylistError ? err.message : 'Couldn’t create it.' }
    }
  })

  handle('playlists:rename', (event, id: unknown, name: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.rename(id, name))()
  })

  handle('playlists:delete', (event, id: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.remove(id))()
  })

  handle('playlists:add', (event, id: unknown, infoHash: unknown, key: unknown) => {
    assertTrustedSender(event)
    return playlistCall(async () => {
      // Song details come from the loaded torrent, not from the UI.
      const info = isInfoHash(infoHash) && typeof key === 'string' ? torrents.songInfo(infoHash, key) : undefined
      if (info) await playlists.add(id, [info])
    })()
  })

  handle('playlists:add-songs', (event, id: unknown, songs: unknown) => {
    assertTrustedSender(event)
    // Known songs (from the liked list or another playlist); re-validated like a backup entry.
    return playlistCall(() => playlists.add(id, Array.isArray(songs) ? songs.slice(0, 5000) : []))()
  })

  handle('playlists:remove', (event, id: unknown, songId: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.removeSong(id, songId))()
  })

  handle('playlists:move', (event, id: unknown, from: unknown, to: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.move(id, from, to))()
  })
}
