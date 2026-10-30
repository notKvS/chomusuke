import { ipcMain } from 'electron'
import type { IpcDeps } from './deps.ts'
import { HEX_COLOR } from './guard.ts'

/** Height of the renderer's top bar at 100% zoom. */
const TITLE_BAR_HEIGHT = 68

/**
 * Height of the native window-controls overlay: the top bar minus its bottom border line, so the theme's
 * border runs the full width under the minimise/maximise/close buttons instead of stopping at them.
 */
export const overlayHeight = (zoom: number) => Math.round(TITLE_BAR_HEIGHT * zoom) - Math.ceil(zoom)

/** Window chrome that follows the theme. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender } = deps
  // Theme-driven window chrome: zoom (the "interface size" setting) and the title-bar overlay colours.
  ipcMain.handle('ui:set-window-appearance', (event, raw: unknown) => {
    assertTrustedSender(event)
    const mainWindow = deps.mainWindow()
    if (!raw || typeof raw !== 'object' || !mainWindow) return
    const { zoom, titleBarColor, titleBarSymbolColor } = raw as Record<string, unknown>
    const factor = typeof zoom === 'number' && Number.isFinite(zoom) ? Math.min(1.3, Math.max(0.8, zoom)) : 1
    mainWindow.webContents.setZoomFactor(factor)
    if (
      typeof titleBarColor === 'string' &&
      HEX_COLOR.test(titleBarColor) &&
      typeof titleBarSymbolColor === 'string' &&
      HEX_COLOR.test(titleBarSymbolColor)
    ) {
      mainWindow.setBackgroundColor(titleBarColor)
      // Only Windows and Linux draw an overlay; macOS uses traffic lights.
      if (process.platform !== 'darwin') {
        mainWindow.setTitleBarOverlay({
          color: titleBarColor,
          symbolColor: titleBarSymbolColor,
          height: overlayHeight(factor)
        })
      }
    }
  })
}
