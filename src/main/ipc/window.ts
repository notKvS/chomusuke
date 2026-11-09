import type { IpcDeps } from './deps.ts'
import { HEX_COLOR, handle } from './guard.ts'

const CONTROLS = new Set(['minimize', 'toggle-maximize', 'close'])

/**
 * Window chrome that follows the theme. On Windows and Linux the window has no native frame: the top bar draws
 * its own minimise/maximise/close buttons (WindowControls.tsx), which call back in here.
 */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender } = deps
  // Theme-driven window chrome: zoom (the "interface size" setting) and the colour shown while the page repaints.
  handle('ui:set-window-appearance', (event, raw: unknown) => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!raw || typeof raw !== 'object' || !mainWindow) return
    const { zoom, titleBarColor } = raw as Record<string, unknown>
    const factor = typeof zoom === 'number' && Number.isFinite(zoom) ? Math.min(1.3, Math.max(0.8, zoom)) : 1
    mainWindow.webContents.setZoomFactor(factor)
    if (typeof titleBarColor === 'string' && HEX_COLOR.test(titleBarColor)) mainWindow.setBackgroundColor(titleBarColor)
  })

  handle('window:control', (event, action: unknown) => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!mainWindow || typeof action !== 'string' || !CONTROLS.has(action)) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'close') mainWindow.close()
    else if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })

  handle('window:is-maximized', event => {
    assertTrustedSender(event)
    return deps.mainWindow()?.isMaximized() ?? false
  })
}
