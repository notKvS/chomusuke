import { ipcMain, shell } from 'electron'
import type { SaveTorrentResult } from '../../shared/types.ts'
import { handleCrash } from '../crash.ts'
import { logDir, logger } from '../log.ts'
import { saveLogFile } from '../log-export.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const LEVELS = new Set(['error', 'warn', 'info', 'debug'])
const MAX_MESSAGE = 4000

/**
 * Lines from the player window into the app log, opening the log folder, saving the log as a file to send on, and
 * the player window reporting that it broke (which ends in the crash dialog).
 */
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
    const sources = deps.settings.list().map(p => `${p.name}${p.enabled ? '' : ' (off)'}`)
    return saveLogFile(mainWindow, [`Sources in search order: ${sources.join(', ')}`])
  })

  // The window's page couldn't draw itself any more (see ErrorBoundary): tell the user and restart.
  handle('crash:report', (event, details: unknown) => {
    assertTrustedSender(event)
    void handleCrash('window-error', typeof details === 'string' ? details.slice(0, MAX_MESSAGE) : undefined)
  })
}
