import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import parseTorrent, { toMagnetURI } from 'parse-torrent'
import type { BackupExportResult, BackupImportResult } from '../../shared/types.ts'
import { BackupError, buildBackup, MAX_BACKUP_BYTES, parseBackup } from '../backup.ts'
import type { TorrentEngine } from '../engine.ts'
import type { SeedLibrary } from '../seeding.ts'
import type { IpcDeps } from './deps.ts'

/** Re-downloads albums from a backup in the background and keeps them, one at a time. */
async function restoreAlbums(
  library: SeedLibrary,
  torrents: TorrentEngine,
  albums: Array<{ infoHash: string; title: string; artist?: string; magnet: string }>
): Promise<void> {
  for (const album of albums) {
    try {
      await torrents.load(album.magnet, { title: album.title, artist: album.artist })
      const kept = torrents.keep(album.infoHash)
      if (kept) {
        await library.add(
          { infoHash: album.infoHash, title: album.title, artist: album.artist, size: kept.size },
          kept.torrentFile
        )
      }
    } catch (err) {
      console.error(`[backup] couldn't restore ${album.infoHash}:`, err instanceof Error ? err.message : err)
    }
  }
}

/** Kept albums as magnet links (from their saved .torrent files), for a backup. */
async function keptAlbumsForBackup(
  library: SeedLibrary
): Promise<Array<{ infoHash: string; title: string; artist?: string; magnet: string }>> {
  const albums = []
  for (const entry of library.list()) {
    try {
      const parsed = await parseTorrent(await library.readTorrent(entry.infoHash))
      albums.push({ infoHash: entry.infoHash, title: entry.title, artist: entry.artist, magnet: toMagnetURI(parsed) })
    } catch {
      albums.push({
        infoHash: entry.infoHash,
        title: entry.title,
        artist: entry.artist,
        magnet: `magnet:?xt=urn:btih:${entry.infoHash}`
      })
    }
  }
  return albums
}

/** Exporting ratings, saved albums, playlists and appearance to a file, and importing one. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, library, ratings, playlists } = deps
  ipcMain.handle('backup:export', async (event, appearance: unknown): Promise<BackupExportResult> => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!mainWindow) return null
    const day = new Date().toISOString().slice(0, 10)
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chomusuke backup',
      defaultPath: path.join(app.getPath('documents'), `chomusuke-backup-${day}.json`),
      filters: [{ name: 'Chomusuke backup', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    try {
      const backup = buildBackup({
        app: `Chomusuke ${app.getVersion()}`,
        ratings: ratings.list(),
        albums: await keptAlbumsForBackup(library),
        playlists: playlists.list(),
        appearance
      })
      await writeFile(picked.filePath, JSON.stringify(backup, null, 2), 'utf8')
      return {
        ok: true,
        path: picked.filePath,
        songs: backup.ratings.length,
        albums: backup.albums.length,
        playlists: backup.playlists.length
      }
    } catch {
      return { ok: false, error: 'Couldn’t save the backup there.' }
    }
  })

  ipcMain.handle('backup:import', async (event): Promise<BackupImportResult> => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Chomusuke backup',
      properties: ['openFile'],
      filters: [{ name: 'Chomusuke backup', extensions: ['json'] }]
    })
    const filePath = picked.filePaths[0]
    if (picked.canceled || !filePath) return null
    try {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_BACKUP_BYTES) throw new BackupError('That file isn’t a Chomusuke backup.')
      const backup = parseBackup(await readFile(filePath, 'utf8'))
      const songs = await ratings.merge(backup.ratings)
      const mergedPlaylists = await playlists.merge(backup.playlists)
      const albums = backup.albums.filter(album => !library.has(album.infoHash))
      void restoreAlbums(library, torrents, albums)
      return { ok: true, songs, albums: albums.length, playlists: mergedPlaylists, appearance: backup.appearance }
    } catch (err) {
      if (err instanceof BackupError) return { ok: false, error: err.message }
      console.error('[backup] import failed:', err)
      return { ok: false, error: 'Couldn’t read that backup.' }
    }
  })
}
