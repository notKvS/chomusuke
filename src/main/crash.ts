import { app, dialog, shell } from 'electron'
import { type CrashKind, crashDetail } from './crash-info.ts'
import { logger } from './log.ts'
import { saveLogFile } from './log-export.ts'

const log = logger('crash')

/** Quitting runs the app's shutdown (saving albums…); if the crash left that stuck, leave anyway after this long. */
const LEAVE_AFTER_MS = 5000

let handling = false

/**
 * Tells the user the app crashed and what to do about it, then restarts (or quits). "Share with developer" saves the
 * log as a file (and shows it in its folder) so the user can send it on. A native dialog, because the window may be
 * the thing that died. Only one crash is handled: whatever else fails while the dialog is up is only logged.
 */
export async function handleCrash(kind: CrashKind, error?: unknown): Promise<void> {
  if (handling) return
  handling = true
  log.error(`crashed (${kind}):`, error)
  let restart = true
  try {
    restart = await ask(kind)
  } catch (err) {
    log.error('the crash dialog failed:', err)
  }
  if (restart) app.relaunch()
  app.quit()
  setTimeout(() => app.exit(0), LEAVE_AFTER_MS).unref()
}

/** Shows the dialog until the user picks something that ends it; true to restart, false to quit. */
async function ask(kind: CrashKind): Promise<boolean> {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Chomusuke crashed',
      message: 'Something went wrong and Chomusuke has to restart.',
      detail: crashDetail(kind),
      buttons: ['Share with developer', 'Restart', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 1) return true
    if (response === 2) return false

    const saved = await saveLogFile(null, [`Crash: ${kind}`])
    if (saved?.ok) {
      shell.showItemInFolder(saved.path)
      return true
    }
    // Cancelled, or it couldn't be saved (say so): back to the choices.
    if (saved) await dialog.showMessageBox({ type: 'warning', message: saved.error, buttons: ['OK'] })
  }
}

/** Errors in the main process that nothing caught end in the crash dialog instead of Electron's bare one. */
export function watchForCrashes(): void {
  process.on('uncaughtException', error => void handleCrash('main-error', error))
}
