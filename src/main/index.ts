import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, safeStorage, session } from 'electron'
import { TorrentEngine } from './engine.ts'
import { BUNDLED_REPOSITORY, bundledExtensions } from './extension-host/defaults.ts'
import { ExtensionHost, hostPage } from './extension-host/host.ts'
import type { ExtensionManifest } from './extension-host/manifest.ts'
import * as backup from './ipc/backup.ts'
import type { IpcDeps } from './ipc/deps.ts'
import { trustedSenderGuard } from './ipc/guard.ts'
import * as libraryIpc from './ipc/library.ts'
import { applySharing, seedLibrary } from './ipc/library.ts'
import * as playlistsIpc from './ipc/playlists.ts'
import * as providers from './ipc/providers.ts'
import * as ratingsIpc from './ipc/ratings.ts'
import * as search from './ipc/search.ts'
import * as sources from './ipc/sources.ts'
import * as torrent from './ipc/torrent.ts'
import * as windowIpc from './ipc/window.ts'
import { overlayHeight } from './ipc/window.ts'
import { PlaylistStore } from './playlists.ts'
import { ProviderRegistry } from './providers/registry.ts'
import { ProviderSettingsStore, type SecretBox } from './providers/settings.ts'
import { RatingsStore } from './ratings.ts'
import { SeedLibrary } from './seeding.ts'
import { type StreamServer, startStreamServer } from './stream-server.ts'

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

let mainWindow: BrowserWindow | null = null
let engine: TorrentEngine | null = null
let streamServer: StreamServer | null = null

/** One sandbox per installed extension, kept while its code is unchanged and torn down otherwise. */
const extensionHosts = new Map<string, { sha: string; host: ExtensionHost }>()

function extensionRuntime(manifest: ExtensionManifest, code: string, codeSha256: string): ExtensionHost {
  const existing = extensionHosts.get(manifest.id)
  if (existing?.sha === codeSha256) return existing.host
  existing?.host.dispose()
  const host = new ExtensionHost(
    manifest,
    code,
    codeSha256,
    hostPage(process.env.ELECTRON_RENDERER_URL, app.isPackaged, import.meta.dirname)
  )
  extensionHosts.set(manifest.id, { sha: codeSha256, host })
  return host
}

function disposeUnusedHosts(activeIds: Set<string>): void {
  for (const [id, entry] of extensionHosts) {
    if (activeIds.has(id)) continue
    entry.host.dispose()
    extensionHosts.delete(id)
  }
}

// Own taskbar identity on Windows, so the icon isn't taken from (or cached as) the generic electron.exe.
if (process.platform === 'win32') app.setAppUserModelId('com.chomusuke.app')
if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
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

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  return win
}

function registerIpc(torrents: TorrentEngine, registry: ProviderRegistry, settings: ProviderSettingsStore): void {
  const deps: IpcDeps = {
    assertTrustedSender: trustedSenderGuard(() => mainWindow),
    mainWindow: () => mainWindow,
    torrents,
    registry,
    settings,
    library,
    ratings,
    playlists,
    extensionRuntime,
    disposeUnusedHosts
  }
  // Providers first: it builds the search sources the other handlers use.
  for (const area of [providers, sources, search, torrent, libraryIpc, ratingsIpc, playlistsIpc, backup, windowIpc]) {
    area.register(deps)
  }
}

async function shutdown(): Promise<void> {
  for (const { host } of extensionHosts.values()) host.dispose()
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
      .catch(err => console.error('[library] couldn’t record', t.infoHash, err))
  }
  const move = new Set([...kept, ...streamed.map(t => t.infoHash)])
  for (const { infoHash, storePath } of (await engine?.release(move)) ?? []) {
    await library.adopt(infoHash, storePath).catch(err => console.error('[library] couldn’t keep', infoHash, err))
  }
  await Promise.allSettled([engine?.destroy(), streamServer?.close()])
  // Opted out: forget streamed music; otherwise trim it to the space the user allowed.
  if (library.sharing.seedStreamed) await library.enforceStreamCap().catch(() => {})
  else await library.clearStreamed().catch(() => {})
  await library.purge().catch(() => {})
  await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
}

let shuttingDown = false
app.on('will-quit', event => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  void shutdown().finally(() => app.quit())
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
    await settings.syncBundled(BUNDLED_REPOSITORY, bundledExtensions())
  } catch (err) {
    console.error('[settings] could not install the bundled extensions:', err instanceof Error ? err.message : err)
  }

  await library.load()
  await ratings.load()
  await playlists.load()
  await library.purge().catch(() => {})

  let torrents: TorrentEngine | null = null
  streamServer = await startStreamServer((infoHash, fileIndex) => torrents?.resolveFile(infoHash, fileIndex))
  torrents = engine = new TorrentEngine(cacheDir, streamServer.baseUrl, library.dataDir)
  applySharing(library, torrents)
  registerIpc(torrents, new ProviderRegistry(), settings)

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
    // Hidden extension sandboxes are windows too; closing the player window means quitting.
    app.quit()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] renderer gone:', details.reason)
    if (details.reason !== 'clean-exit') mainWindow?.reload()
  })

  void seedLibrary(library, torrents)

  setInterval(() => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed() && !contents.isCrashed()) contents.send('torrent:stats', torrents.stats())
  }, STATS_INTERVAL_MS)
})
