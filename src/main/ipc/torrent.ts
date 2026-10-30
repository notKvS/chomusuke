import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain } from 'electron'
import type { SaveTorrentResult, TorrentDetails } from '../../shared/types.ts'
import { isInfoHash } from '../seeding.ts'
import type { IpcDeps } from './deps.ts'
import { safeFileName } from './guard.ts'

/** A loaded torrent's details, and sharing it as a .torrent file or a magnet link. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, library } = deps
  ipcMain.handle('torrent:details', (event, infoHash: unknown): TorrentDetails | null => {
    assertTrustedSender(event)
    if (!isInfoHash(infoHash)) return null
    return torrents.details(infoHash, library.has(infoHash)) ?? null
  })

  ipcMain.handle('torrent:save-file', async (event, infoHash: unknown): Promise<SaveTorrentResult> => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    const file = isInfoHash(infoHash) ? torrents.torrentFile(infoHash) : undefined
    if (!file || !mainWindow) return { ok: false, error: 'That torrent isn’t loaded any more.' }
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Save .torrent file',
      defaultPath: path.join(app.getPath('downloads'), `${safeFileName(file.name)}.torrent`),
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    try {
      await writeFile(picked.filePath, file.data)
      return { ok: true, path: picked.filePath }
    } catch {
      return { ok: false, error: 'Couldn’t save the file there.' }
    }
  })

  ipcMain.handle('torrent:copy-magnet', (event, infoHash: unknown): boolean => {
    assertTrustedSender(event)
    const magnet = isInfoHash(infoHash) ? torrents.magnet(infoHash) : undefined
    if (magnet) clipboard.writeText(magnet)
    return magnet !== undefined
  })
}
