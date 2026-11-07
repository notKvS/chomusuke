import { app, ipcMain } from 'electron'
import type { IpcDeps } from './deps.ts'

/** Updating the app from GitHub releases. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, updater } = deps
  ipcMain.handle('update:state', event => {
    assertTrustedSender(event)
    return updater.current()
  })
  ipcMain.handle('update:check', event => {
    assertTrustedSender(event)
    return updater.check()
  })
  // Quits the usual way (albums are kept, the cache cleared), then the updater installs and reopens the app.
  ipcMain.handle('update:install', event => {
    assertTrustedSender(event)
    if (updater.requestRestart()) app.quit()
  })
  ipcMain.handle('update:open-page', event => {
    assertTrustedSender(event)
    updater.openReleasePage()
  })
}
