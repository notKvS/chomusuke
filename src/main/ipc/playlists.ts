import { ipcMain } from 'electron'
import type { Playlist } from '../../shared/types.ts'
import { PlaylistError } from '../playlists.ts'
import { isInfoHash } from '../seeding.ts'
import type { IpcDeps } from './deps.ts'

/** User playlists. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, playlists } = deps
  // Playlists: every handler answers with the full list, so the UI always shows what's saved.
  const playlistCall = (work: () => Promise<unknown>) => async (): Promise<Playlist[]> => {
    try {
      await work()
    } catch (err) {
      if (!(err instanceof PlaylistError)) console.error('[playlists]', err)
    }
    return playlists.list()
  }

  ipcMain.handle('playlists:list', (event): Playlist[] => {
    assertTrustedSender(event)
    return playlists.list()
  })

  ipcMain.handle('playlists:create', async (event, name: unknown) => {
    assertTrustedSender(event)
    try {
      const playlist = await playlists.create(name)
      return { playlists: playlists.list(), id: playlist.id }
    } catch (err) {
      return { playlists: playlists.list(), error: err instanceof PlaylistError ? err.message : 'Couldn’t create it.' }
    }
  })

  ipcMain.handle('playlists:rename', (event, id: unknown, name: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.rename(id, name))()
  })

  ipcMain.handle('playlists:delete', (event, id: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.remove(id))()
  })

  ipcMain.handle('playlists:add', (event, id: unknown, infoHash: unknown, key: unknown) => {
    assertTrustedSender(event)
    return playlistCall(async () => {
      // Song details come from the loaded torrent, not from the UI.
      const info = isInfoHash(infoHash) && typeof key === 'string' ? torrents.songInfo(infoHash, key) : undefined
      if (info) await playlists.add(id, [info])
    })()
  })

  ipcMain.handle('playlists:add-songs', (event, id: unknown, songs: unknown) => {
    assertTrustedSender(event)
    // Known songs (from the liked list or another playlist); re-validated like a backup entry.
    return playlistCall(() => playlists.add(id, Array.isArray(songs) ? songs.slice(0, 5000) : []))()
  })

  ipcMain.handle('playlists:remove', (event, id: unknown, songId: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.removeSong(id, songId))()
  })

  ipcMain.handle('playlists:move', (event, id: unknown, from: unknown, to: unknown) => {
    assertTrustedSender(event)
    return playlistCall(() => playlists.move(id, from, to))()
  })
}
