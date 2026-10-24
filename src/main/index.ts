import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { TorrentEngine } from './engine.ts'
import { ExtensionHost, hostPage } from './extensions/host.ts'
import { ExtensionError, parseRepository, type ExtensionManifest } from './extensions/manifest.ts'
import { testExtension } from './extensions/provider.ts'
import { FetchError, fetchJson, fetchText } from './http.ts'
import { annotationsForTorrentUrl } from './providers/archive.ts'
import { archiveJsonFetcher, buildProviders } from './providers/index.ts'
import { ProviderRegistry } from './providers/registry.ts'
import { ProviderSettingsStore, SettingsError, validateRepositoryUrl, type SecretBox } from './providers/settings.ts'
import { testTorznab, TorznabError } from './providers/torznab.ts'
import type { Playable } from './providers/types.ts'
import { parseSource, SourceError } from './source.ts'
import { startStreamServer, type StreamServer } from './stream-server.ts'
import { fetchTorrentFile } from './torrent-fetch.ts'
import type {
  Album,
  BrowseResponse,
  ExploreSource,
  LoadResult,
  ProvidersResponse,
  SearchResponse,
  SourceHints,
  TestResponse
} from '../shared/types.ts'

const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024
const MAX_HINT_LENGTH = 200
const MAX_QUERY_LENGTH = 200
const STATS_INTERVAL_MS = 1000
const REPOSITORY_MAX_BYTES = 512 * 1024
const EXTENSION_CODE_MAX_BYTES = 2 * 1024 * 1024
const EXTENSION_FETCH_TIMEOUT_MS = 20_000

/** API keys are encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS, libsecret on Linux). */
const secretBox: SecretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: plain => safeStorage.encryptString(plain).toString('base64'),
  decrypt: cipher => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}

// Session-scoped cache: wiped on launch and on quit so streamed audio never piles up on disk.
const cacheDir = path.join(app.getPath('temp'), 'chomusuke-cache')

let mainWindow: BrowserWindow | null = null
let engine: TorrentEngine | null = null
let streamServer: StreamServer | null = null

/** One sandbox per installed extension, kept while its code is unchanged and torn down otherwise. */
const extensionHosts = new Map<string, { sha: string; host: ExtensionHost }>()

function extensionRuntime(manifest: ExtensionManifest, code: string, codeSha256: string): ExtensionHost {
  const existing = extensionHosts.get(manifest.id)
  if (existing?.sha === codeSha256) return existing.host
  existing?.host.dispose()
  const host = new ExtensionHost(manifest, code, codeSha256, hostPage(process.env.ELECTRON_RENDERER_URL, app.isPackaged, import.meta.dirname))
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

/** Downloads a repository manifest and every extension's code it lists. */
async function downloadRepository(rawUrl: unknown): Promise<{ url: string; installs: Array<{ manifest: ExtensionManifest; code: string }> }> {
  const { url, privateHttp } = validateRepositoryUrl(rawUrl)
  const origin = new URL(url).origin
  const policy = {
    timeoutMs: EXTENSION_FETCH_TIMEOUT_MS,
    // Plain http only for a repository on your own network, and only on its own origin.
    allowHttp: (target: URL) => privateHttp && target.origin === origin
  }
  try {
    const manifests = parseRepository(await fetchJson(url, { ...policy, maxBytes: REPOSITORY_MAX_BYTES }), url, privateHttp)
    const installs = await Promise.all(
      manifests.map(async manifest => ({
        manifest,
        code: await fetchText(manifest.codeUrl, { ...policy, maxBytes: EXTENSION_CODE_MAX_BYTES, accept: 'text/javascript, */*;q=0.5' })
      }))
    )
    return { url, installs }
  } catch (err) {
    if (err instanceof ExtensionError || err instanceof SettingsError) throw new SettingsError(err.message)
    if (err instanceof FetchError) throw new SettingsError(`Couldn’t download the repository (${err.kind === 'status' ? `HTTP ${err.status}` : err.kind}).`)
    throw err
  }
}

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
    backgroundColor: '#030303',
    title: 'Chomusuke',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#030303', symbolColor: '#ffffff', height: 64 },
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

/** IPC is only accepted from our own top-level frame. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Rejected IPC from untrusted sender')
  }
}

function sanitizeHints(raw: unknown): SourceHints {
  if (!raw || typeof raw !== 'object') return {}
  const pick = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_HINT_LENGTH) : undefined
  const { title, artist } = raw as Record<string, unknown>
  return { title: pick(title), artist: pick(artist) }
}

async function settingsResult(work: () => Promise<unknown>, store: ProviderSettingsStore): Promise<ProvidersResponse> {
  try {
    await work()
    return { ok: true, providers: store.list() }
  } catch (err) {
    if (err instanceof SettingsError) return { ok: false, error: err.message }
    console.error('[settings] failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Couldn’t save your sources.' }
  }
}

async function playableToAlbum(torrents: TorrentEngine, playable: Playable): Promise<Album> {
  const album = await torrents.load(playable.torrent, playable.hints)
  const info = await playable.annotations
  return (info && torrents.annotate(album.infoHash, info)) || album
}

async function toResult(work: () => Promise<Album>): Promise<LoadResult> {
  try {
    return { ok: true, album: await work() }
  } catch (err) {
    if (err instanceof SourceError) return { ok: false, error: err.message }
    console.error('[ipc] unexpected load failure:', err)
    return { ok: false, error: 'Something went wrong while loading this torrent.' }
  }
}

function registerIpc(torrents: TorrentEngine, registry: ProviderRegistry, settings: ProviderSettingsStore): void {
  const rebuildProviders = () => {
    const enabled = settings.enabled()
    registry.setProviders(buildProviders(enabled, { extensionRuntime }))
    disposeUnusedHosts(new Set(enabled.flatMap(p => (p.type === 'extension' ? [p.manifest.id] : []))))
  }
  rebuildProviders()

  ipcMain.handle('source:load', (event, rawSource: unknown, rawHints: unknown) => {
    assertTrustedSender(event)
    return toResult(async () => {
      const source = parseSource(rawSource)
      const hints = sanitizeHints(rawHints)
      if (source.kind === 'magnet') return torrents.load(source.uri, hints)
      // Internet Archive items carry real song titles and durations in their tags; fetch them in parallel.
      const annotations = annotationsForTorrentUrl(source.url, archiveJsonFetcher)
      return playableToAlbum(torrents, { kind: 'torrent', torrent: await fetchTorrentFile(source.url), hints, annotations })
    })
  })

  let activeSearch: AbortController | null = null
  ipcMain.handle('search:query', async (event, rawQuery: unknown): Promise<SearchResponse> => {
    assertTrustedSender(event)
    if (typeof rawQuery !== 'string' || !rawQuery.trim() || rawQuery.length > MAX_QUERY_LENGTH) {
      return { ok: false, error: 'Type a song, album or artist to search for.' }
    }
    // Only one search runs at a time; a new query cancels the previous one's requests.
    activeSearch?.abort()
    const controller = new AbortController()
    activeSearch = controller
    try {
      return { ok: true, results: await registry.search(rawQuery.trim(), controller.signal) }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, error: 'Search was replaced by a newer one.' }
      console.error('[search] failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Search failed. Check your connection and try again.' }
    } finally {
      if (activeSearch === controller) activeSearch = null
    }
  })

  ipcMain.handle('search:open', (event, albumId: unknown) => {
    assertTrustedSender(event)
    return toResult(async () => playableToAlbum(torrents, await registry.open(albumId)))
  })

  ipcMain.handle('providers:list', (event): ProvidersResponse => {
    assertTrustedSender(event)
    return { ok: true, providers: settings.list() }
  })

  ipcMain.handle('providers:save-torznab', (event, form: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.saveTorznab(form)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('providers:set-enabled', (event, id: unknown, enabled: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setEnabled(id, enabled)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('providers:remove', (event, id: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.remove(id)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:import', (event, repositoryUrl: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      const { url, installs } = await downloadRepository(repositoryUrl)
      await settings.installExtensions(url, installs)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:set-options', (event, id: unknown, values: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setExtensionOptions(id, values)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:test', async (event, id: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.extensionConfig(id)
      const runtime = extensionRuntime(config.manifest, config.code, config.codeSha256)
      return { ok: true, message: await testExtension(config.manifest, runtime, config.options) }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof ExtensionError) return { ok: false, error: err.message }
      console.error('[extensions] test failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'The extension isn’t working.' }
    }
  })

  ipcMain.handle('explore:sources', (event): ExploreSource[] => {
    assertTrustedSender(event)
    return registry.explore()
  })

  ipcMain.handle('explore:browse', async (event, sourceId: unknown, categoryId: unknown): Promise<BrowseResponse> => {
    assertTrustedSender(event)
    try {
      return { ok: true, section: await registry.browse(sourceId, categoryId, AbortSignal.timeout(30_000)) }
    } catch (err) {
      if (err instanceof SourceError) return { ok: false, error: err.message }
      console.error('[explore] failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Couldn’t load that category.' }
    }
  })

  ipcMain.handle('providers:test-torznab', async (event, form: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.resolveTorznab(form)
      return { ok: true, message: await testTorznab({ ...config, id: config.id ?? 'torznab-test' }) }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof TorznabError) return { ok: false, error: err.message }
      console.error('[settings] test failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Couldn’t reach that indexer.' }
    }
  })

  ipcMain.handle('source:open-file', async event => {
    assertTrustedSender(event)
    const picked = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open a .torrent file',
      properties: ['openFile'],
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    const filePath = picked.filePaths[0]
    if (picked.canceled || !filePath) return null
    return toResult(async () => {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_TORRENT_FILE_BYTES) throw new SourceError('That file is not a usable .torrent file.')
      return torrents.load(await readFile(filePath))
    })
  })
}

async function shutdown(): Promise<void> {
  for (const { host } of extensionHosts.values()) host.dispose()
  await Promise.allSettled([engine?.destroy(), streamServer?.close()])
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

  let torrents: TorrentEngine | null = null
  streamServer = await startStreamServer((infoHash, fileIndex) => torrents?.resolveFile(infoHash, fileIndex))
  torrents = engine = new TorrentEngine(cacheDir, streamServer.baseUrl)
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

  setInterval(() => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed() && !contents.isCrashed()) contents.send('torrent:stats', torrents.stats())
  }, STATS_INTERVAL_MS)
})
