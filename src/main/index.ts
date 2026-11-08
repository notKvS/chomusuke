import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, safeStorage, session } from 'electron'
import { DiscordPresence } from './discord.ts'
import { TorrentEngine } from './engine.ts'
import { createArtistGenres } from './genres.ts'
import { PlayHistory } from './history.ts'
import * as backup from './ipc/backup.ts'
import type { IpcDeps } from './ipc/deps.ts'
import { trustedSenderGuard } from './ipc/guard.ts'
import * as homeIpc from './ipc/home.ts'
import * as libraryIpc from './ipc/library.ts'
import { applySharing, seedLibrary } from './ipc/library.ts'
import * as logsIpc from './ipc/logs.ts'
import * as playlistsIpc from './ipc/playlists.ts'
import * as presenceIpc from './ipc/presence.ts'
import * as providers from './ipc/providers.ts'
import * as ratingsIpc from './ipc/ratings.ts'
import * as search from './ipc/search.ts'
import * as sources from './ipc/sources.ts'
import * as torrent from './ipc/torrent.ts'
import * as updateIpc from './ipc/update.ts'
import * as windowIpc from './ipc/window.ts'
import { overlayHeight } from './ipc/window.ts'
import { logger } from './log.ts'
import { PlaylistStore } from './playlists.ts'
import { BUNDLED_REPOSITORY, bundledPlugins } from './plugin-host/defaults.ts'
import { hostPage, PluginHost, togglePluginDevTools } from './plugin-host/host.ts'
import type { PluginManifest } from './plugin-host/manifest.ts'
import { CoverFinder } from './providers/covers.ts'
import { ProviderRegistry } from './providers/registry.ts'
import { ProviderSettingsStore, type SecretBox } from './providers/settings.ts'
import { RatingsStore } from './ratings.ts'
import { SeedLibrary } from './seeding.ts'
import { type StreamServer, startStreamServer } from './stream-server.ts'
import { Updater } from './updater.ts'

const log = logger('app')
log.info(
  `Chomusuke ${app.getVersion()} starting (${app.isPackaged ? 'installed' : 'from source'}) — Electron`,
  process.versions.electron,
  `Chrome ${process.versions.chrome}, ${process.platform} ${process.getSystemVersion()} ${process.arch}`
)
log.info('data folder:', app.getPath('userData'))

const STATS_INTERVAL_MS = 1000

/** API keys are encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS, libsecret on Linux). */
const secretBox: SecretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: plain => safeStorage.encryptString(plain).toString('base64'),
  decrypt: cipher => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}

// Scroll pages on the compositor. The content scroller is see-through (the animated background shows behind it), so
// on 100%-scaled displays Chromium would otherwise keep LCD text by scrolling on the main thread and repainting every
// card each frame. Measured on Explore (200 cards): ~30 fps before, a steady 60 after.
app.commandLine.appendSwitch('enable-prefer-compositing-to-lcd-text')

// Session-scoped cache: wiped on launch and on quit so streamed audio never piles up on disk.
const cacheDir = path.join(app.getPath('temp'), 'chomusuke-cache')

// Kept albums (seeded library); survives restarts.
const library = new SeedLibrary(path.join(app.getPath('userData'), 'library'))
// Liked and disliked songs.
const ratings = new RatingsStore(path.join(app.getPath('userData'), 'ratings.json'))
const playlists = new PlaylistStore(path.join(app.getPath('userData'), 'playlists.json'))
// What was played lately, for Home's suggestions.
const history = new PlayHistory(path.join(app.getPath('userData'), 'history.json'))
const artistGenres = createArtistGenres()
// What's playing, as the Discord status.
// Covers for chart entries and for the Discord status.
const covers = new CoverFinder()
const presence = new DiscordPresence(wanted => covers.find(wanted))

let mainWindow: BrowserWindow | null = null
let engine: TorrentEngine | null = null
let streamServer: StreamServer | null = null
let updater: Updater | null = null

/** One sandbox per installed plugin, kept while its code is unchanged and torn down otherwise. */
const pluginHosts = new Map<string, { sha: string; host: PluginHost }>()

function pluginRuntime(manifest: PluginManifest, code: string, codeSha256: string): PluginHost {
  const existing = pluginHosts.get(manifest.id)
  if (existing?.sha === codeSha256) return existing.host
  if (existing) log.info(`plugin ${manifest.id} changed; replacing its sandbox`)
  existing?.host.dispose()
  const host = new PluginHost(
    manifest,
    code,
    codeSha256,
    hostPage(process.env.ELECTRON_RENDERER_URL, app.isPackaged, import.meta.dirname)
  )
  pluginHosts.set(manifest.id, { sha: codeSha256, host })
  return host
}

function disposeUnusedHosts(activeIds: Set<string>): void {
  for (const [id, entry] of pluginHosts) {
    if (activeIds.has(id)) continue
    log.info(`plugin ${id} turned off; closing its sandbox`)
    entry.host.dispose()
    pluginHosts.delete(id)
  }
}

// Own taskbar identity on Windows, so the icon isn't taken from (or cached as) the generic electron.exe.
if (process.platform === 'win32') app.setAppUserModelId('com.chomusuke.app')
if (!app.requestSingleInstanceLock()) {
  log.info('already running; handing over to the open window')
  app.quit()
}

app.on('second-instance', () => {
  log.debug('second launch; focusing the window')
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

// Lock down every web contents: no popups, no navigation away from the app, no <webview>.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.on('will-attach-webview', event => event.preventDefault())
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0a1a',
    title: 'Chomusuke',
    // .ico carries 16–256px sizes so the taskbar and title bar get a crisp icon on Windows.
    icon: path.join(
      import.meta.dirname,
      process.platform === 'win32' ? '../../build/icon.ico' : '../../build/icon.png'
    ),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0a1a', symbolColor: '#f7f2ff', height: overlayHeight(1) },
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())

  // The hidden title bar leaves no menu bar on Windows, so the default menu's DevTools shortcuts never fire.
  // From source they always work; in the installed app only once "Developer tools" is on in Settings.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (app.isPackaged && !library.sharing.developerTools)) return
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    } else if (input.control && input.shift && input.key.toLowerCase() === 'p') {
      // The plugins run in hidden windows of their own; their network errors only show in those DevTools.
      togglePluginDevTools()
      event.preventDefault()
    }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  return win
}

function registerIpc(
  torrents: TorrentEngine,
  registry: ProviderRegistry,
  settings: ProviderSettingsStore,
  updater: Updater
): void {
  const deps: IpcDeps = {
    assertTrustedSender: trustedSenderGuard(() => mainWindow),
    mainWindow: () => mainWindow,
    torrents,
    registry,
    settings,
    library,
    ratings,
    playlists,
    history,
    artistGenres,
    presence,
    pluginRuntime,
    disposeUnusedHosts,
    updater
  }
  // Providers first: it builds the search sources the other handlers use.
  const areas = [
    providers,
    sources,
    search,
    torrent,
    libraryIpc,
    ratingsIpc,
    playlistsIpc,
    homeIpc,
    presenceIpc,
    backup,
    updateIpc,
    logsIpc,
    windowIpc
  ]
  for (const area of areas) area.register(deps)
}

async function shutdown(): Promise<void> {
  const started = performance.now()
  log.info('shutting down')
  for (const { host } of pluginHosts.values()) host.dispose()
  await presence.dispose()
  // Albums kept or streamed this session were downloaded into the cache: move them into the library before the
  // cache goes. Streamed ones only while the user wants them seeded later, and only if anything was downloaded.
  const kept = new Set(library.list().map(entry => entry.infoHash))
  const playedAt = new Date().toISOString()
  const streamed = library.sharing.seedStreamed
    ? (engine?.cachedTorrents() ?? []).filter(t => !kept.has(t.infoHash) && t.downloaded > 0)
    : []
  for (const t of streamed) {
    await library
      .recordStreamed({ infoHash: t.infoHash, title: t.title, artist: t.artist, addedAt: playedAt }, t.torrentFile)
      .catch(err => log.error('library: couldn’t record', t.infoHash, err))
  }
  const move = new Set([...kept, ...streamed.map(t => t.infoHash)])
  const released = (await engine?.release(move)) ?? []
  log.info(`keeping ${released.length} album(s) from this session (${streamed.length} streamed)`)
  for (const { infoHash, storePath } of released) {
    await library.adopt(infoHash, storePath).catch(err => log.error('library: couldn’t keep', infoHash, err))
  }
  await Promise.allSettled([engine?.destroy(), streamServer?.close()])
  // Opted out: forget streamed music; otherwise trim it to the space the user allowed.
  const tidy = (step: string) => (err: unknown) => log.warn(`library: ${step} failed:`, err)
  if (library.sharing.seedStreamed) await library.enforceStreamCap().catch(tidy('trimming streamed music'))
  else await library.clearStreamed().catch(tidy('clearing streamed music'))
  await library.purge().catch(tidy('purging removed albums'))
  await rm(cacheDir, { recursive: true, force: true }).catch(tidy('clearing the cache'))
  log.info(`shut down in ${Math.round(performance.now() - started)} ms`)
}

let shuttingDown = false
app.on('will-quit', event => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  // A downloaded update is installed only now, once albums are kept and the cache is gone.
  void shutdown().finally(() => (updater ? updater.finishQuit() : app.quit()))
})

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  // The app needs no browser permissions (camera, notifications, ...); deny everything.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })

  const settings = new ProviderSettingsStore(path.join(app.getPath('userData'), 'providers.json'), secretBox)
  await settings.load()
  try {
    await settings.syncBundled(BUNDLED_REPOSITORY, bundledPlugins())
  } catch (err) {
    log.error('settings: could not install the bundled plugins:', err)
  }

  await library.load()
  presence.setEnabled(library.sharing.discordStatus)
  await ratings.load()
  await playlists.load()
  await history.load()
  await library.purge().catch(err => log.warn('library: purging removed albums failed:', err))
  log.info(
    `library: ${library.list().length} kept, ${library.listStreamed().length} streamed; sharing`,
    library.sharing
  )

  let torrents: TorrentEngine | null = null
  streamServer = await startStreamServer((infoHash, fileIndex) => torrents?.resolveFile(infoHash, fileIndex))
  torrents = engine = new TorrentEngine(cacheDir, streamServer.baseUrl, library.dataDir)
  applySharing(library, torrents)
  updater = new Updater(state => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed()) contents.send('update:state', state)
  })
  registerIpc(torrents, new ProviderRegistry((albums, signal) => covers.fill(albums, signal)), settings, updater)

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
    // Hidden plugin sandboxes are windows too; closing the player window means quitting.
    app.quit()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('window: renderer gone:', details.reason, `exit code ${details.exitCode}`)
    if (details.reason !== 'clean-exit') mainWindow?.reload()
  })
  mainWindow.webContents.once('did-finish-load', () =>
    log.info(`window loaded ${Math.round(performance.now())} ms after launch`)
  )

  void seedLibrary(library, torrents)
  updater.start()

  setInterval(() => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed() && !contents.isCrashed()) contents.send('torrent:stats', torrents.stats())
  }, STATS_INTERVAL_MS)
})
