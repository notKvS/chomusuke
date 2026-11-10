import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import type { SaveTorrentResult } from '../../shared/types.ts'
import { buildLogExport, logDir, logger } from '../log.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const LEVELS = new Set(['error', 'warn', 'info', 'debug'])
const MAX_MESSAGE = 4000
/** The log file and the one before it (see log.ts), oldest first. */
const LOG_FILES = ['main.old.log', 'main.log']

/** Lines from the player window into the app log, opening the log folder, and saving the log as a file to send on. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender } = deps
  const log = logger('renderer')

  // Fire-and-forget (send, not invoke), so logging never waits and isn't itself logged as an IPC call.
  ipcMain.on('logs:write', (event, level: unknown, message: unknown) => {
    try {
      assertTrustedSender(event)
    } catch {
      return
    }
    if (typeof level !== 'string' || !LEVELS.has(level) || typeof message !== 'string') return
    log[level as 'error' | 'warn' | 'info' | 'debug'](message.slice(0, MAX_MESSAGE))
  })

  handle('logs:open', async event => {
    assertTrustedSender(event)
    const error = await shell.openPath(logDir())
    if (error) throw new Error(`Couldn't open the log folder: ${error}`)
  })

  handle('logs:export', async (event): Promise<SaveTorrentResult> => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!mainWindow) return null
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the log',
      defaultPath: path.join(app.getPath('downloads'), `chomusuke-log-${new Date().toISOString().slice(0, 10)}.txt`),
      filters: [{ name: 'Text file', extensions: ['txt'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    try {
      const files = await Promise.all(
        LOG_FILES.map(name => readFile(path.join(logDir(), name), 'utf8').catch(() => ''))
      )
      const sources = deps.settings.list().map(p => `${p.name}${p.enabled ? '' : ' (off)'}`)
      const header = [
        `Chomusuke ${app.getVersion()} log, saved ${new Date().toISOString()}`,
        `System: ${os.type()} ${os.release()} (${process.arch}), Electron ${process.versions.electron}`,
        `Sources in search order: ${sources.join(', ')}`,
        'Lines saying a source "returned no results" show which source found nothing, and for what.'
      ]
      await writeFile(picked.filePath, buildLogExport(header, files), 'utf8')
      return { ok: true, path: picked.filePath }
    } catch (err) {
      log.error('couldn’t save the log:', err)
      return { ok: false, error: 'Couldn’t save the log file.' }
    }
  })
}
