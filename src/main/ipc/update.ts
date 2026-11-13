import { app } from 'electron'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

/** Updating the app from GitHub releases. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, updater } = deps
  handle('update:state', event => {
    assertTrustedSender(event)
    return updater.current()
  })
  handle('update:check', event => {
    assertTrustedSender(event)
    return updater.check()
  })
  // Quits the usual way (albums are kept, the cache cleared), then the updater installs and reopens the app.
  handle('update:install', event => {
    assertTrustedSender(event)
    if (updater.requestRestart()) app.quit()
  })
  handle('update:download', event => {
    assertTrustedSender(event)
    updater.download()
  })
}
