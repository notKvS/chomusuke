import { ipcMain, shell } from 'electron'
import { logDir, logger } from '../log.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const LEVELS = new Set(['error', 'warn', 'info', 'debug'])
const MAX_MESSAGE = 4000

/** Lines from the player window into the app log, and opening the log folder. */
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
}
