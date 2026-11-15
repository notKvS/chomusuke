// Updating from GitHub releases: checks at launch and every few hours; where this copy can replace itself it downloads
// (in the background, or when asked if automatic updates are off) and asks to restart, elsewhere it only says a new
// version is out (see update-mode.ts).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
// Type-only: electron-updater takes ~0.4 s to load, so it's imported at the first check, after the window is up.
import type { AppUpdater } from 'electron-updater'
import type { UpdateState, UpdateStatus } from '../shared/types.ts'
import { logger } from './log.ts'
import { releasePageUrl, type UpdateMode, updateMode } from './update-mode.ts'

const log = logger('updater')

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export class Updater {
  private readonly mode: UpdateMode
  private status: UpdateStatus
  private restartPending = false
  private readonly onChange: (state: UpdateState) => void
  /** Download new versions without asking (where this copy installs them itself). */
  private autoDownload: boolean
  private loading: Promise<AppUpdater> | null = null
  /** Set once loaded; a version can only be ready to install after that. */
  private loaded: AppUpdater | null = null

  /** `autoUpdate`: download new versions without asking (the `autoUpdate` setting). */
  constructor(onChange: (state: UpdateState) => void, autoUpdate: boolean) {
    this.onChange = onChange
    this.mode = updateMode({
      isPackaged: app.isPackaged,
      platform: process.platform,
      // The installer puts "Uninstall <productName>.exe" next to the app (productName in electron-builder.yml).
      nsisInstalled: existsSync(path.join(path.dirname(process.execPath), 'Uninstall Chomusuke.exe')),
      appImage: Boolean(process.env.APPIMAGE)
    })
    this.status = this.mode === 'off' ? { state: 'off' } : { state: 'idle' }
    this.autoDownload = this.mode === 'auto' && autoUpdate
    log.info(`update mode: ${this.mode}`)
  }

  /** electron-updater's updater, loaded and wired up on first use. */
  private updater(): Promise<AppUpdater> {
    this.loading ??= import('electron-updater').then(module => this.wire(module.default.autoUpdater))
    return this.loading
  }

  private wire(autoUpdater: AppUpdater): AppUpdater {
    autoUpdater.autoDownload = this.autoDownload
    // Applies only once an update is downloaded, so also to one downloaded on request.
    autoUpdater.autoInstallOnAppQuit = this.mode === 'auto'
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date' }))
    autoUpdater.on('update-available', ({ version }) =>
      this.set(
        autoUpdater.autoDownload ? { state: 'downloading', version, percent: 0 } : { state: 'available', version }
      )
    )
    autoUpdater.on('download-progress', ({ percent }) => {
      if (this.status.state === 'downloading') this.set({ ...this.status, percent: Math.round(percent) })
    })
    autoUpdater.on('update-downloaded', ({ version }) => this.set({ state: 'ready', version }))
    autoUpdater.on('error', err => {
      log.error(err)
      this.set({ state: 'error', message: 'Couldn’t check for updates. Try again later.' })
    })
    this.loaded = autoUpdater
    return autoUpdater
  }

  /** First check now, then every few hours. */
  start(): void {
    if (this.mode === 'off') return
    void this.check()
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref()
  }

  current(): UpdateState {
    return { currentVersion: app.getVersion(), status: this.status, selfUpdate: this.mode === 'auto' }
  }

  /** The `autoUpdate` setting changed; turning it on downloads a version that is waiting to be asked for. */
  setAutoUpdate(on: boolean): void {
    if (this.mode !== 'auto') return
    this.autoDownload = on
    if (this.loaded) this.loaded.autoDownload = on
    if (on) this.download()
  }

  async check(): Promise<UpdateState> {
    const busy = ['off', 'checking', 'downloading', 'ready'].includes(this.status.state)
    if (!busy) {
      // Failures also arrive as the 'error' event, which sets the status.
      const result = await this.updater()
        .then(updater => updater.checkForUpdates())
        .catch(() => undefined)
      if (result === null) this.set({ state: 'idle' })
    }
    return this.current()
  }

  /** "Restart now": true when the app should quit; `finishQuit` then installs instead of plainly quitting. */
  requestRestart(): boolean {
    if (this.status.state !== 'ready') return false
    this.restartPending = true
    return true
  }

  /** Last step of quitting, once everything is saved: installs and reopens when a restart was asked for. */
  finishQuit(): void {
    // quitAndInstall only quits when the installer started; quit regardless so a failed install never hangs.
    if (this.restartPending) this.loaded?.quitAndInstall()
    app.quit()
  }

  /** "Download": fetches the new version in the background where this copy can install it, else opens its release page. */
  download(): void {
    if (this.status.state !== 'available') return
    const { version } = this.status
    if (this.mode !== 'auto') {
      void shell.openExternal(releasePageUrl(version))
      return
    }
    this.set({ state: 'downloading', version, percent: 0 })
    // Failures also arrive as the 'error' event, which sets the status.
    this.updater()
      .then(updater => updater.downloadUpdate())
      .catch(() => undefined)
  }

  private set(status: UpdateStatus): void {
    // Download progress would be a line per percent; the start and the end are enough.
    if (status.state !== this.status.state) log.info('status:', status)
    this.status = status
    this.onChange(this.current())
  }
}
