import { readFile, stat } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import type { Album } from '../../shared/types.ts'
import type { TorrentEngine } from '../engine.ts'
import { annotationsForTorrentUrl } from '../providers/archive.ts'
import { archiveJsonFetcher } from '../providers/index.ts'
import type { Playable } from '../providers/types.ts'
import { parseSource, SourceError } from '../source.ts'
import { fetchTorrentFile } from '../torrent-fetch.ts'
import type { IpcDeps } from './deps.ts'
import { sanitizeHints, toResult } from './guard.ts'

const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024

/** Loads a provider's torrent, then adds its song details (titles, durations) if it has any. */
export async function playableToAlbum(torrents: TorrentEngine, playable: Playable): Promise<Album> {
  const album = await torrents.load(playable.torrent, playable.hints)
  const info = await playable.annotations
  return (info && torrents.annotate(album.infoHash, info)) || album
}

/** Opening a magnet or torrent link, or a .torrent file picked from disk. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, library } = deps
  ipcMain.handle('source:load', (event, rawSource: unknown, rawHints: unknown) => {
    assertTrustedSender(event)
    return toResult(library, async () => {
      const source = parseSource(rawSource)
      const hints = sanitizeHints(rawHints)
      if (source.kind === 'magnet') return torrents.load(source.uri, hints)
      // Internet Archive items carry real song titles and durations in their tags; fetch them in parallel.
      const annotations = annotationsForTorrentUrl(source.url, archiveJsonFetcher)
      return playableToAlbum(torrents, {
        kind: 'torrent',
        torrent: await fetchTorrentFile(source.url),
        hints,
        annotations
      })
    })
  })

  ipcMain.handle('source:open-file', async event => {
    assertTrustedSender(event) // also guarantees mainWindow is set
    const mainWindow = deps.mainWindow()
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a .torrent file',
      properties: ['openFile'],
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    const filePath = picked.filePaths[0]
    if (picked.canceled || !filePath) return null
    return toResult(library, async () => {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_TORRENT_FILE_BYTES)
        throw new SourceError('That file is not a usable .torrent file.')
      return torrents.load(await readFile(filePath))
    })
  })
}
