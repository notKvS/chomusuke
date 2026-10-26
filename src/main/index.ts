import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent, ipcMain, safeStorage, session } from 'electron'
import parseTorrent from 'parse-torrent'
import type {
  Album,
  BrowseResponse,
  ExploreSource,
  LibraryResponse,
  LibraryView,
  LoadResult,
  ProvidersResponse,
  SaveTorrentResult,
  SearchResponse,
  SourceHints,
  TestResponse,
  TorrentDetails
} from '../shared/types.ts'
import { TorrentEngine } from './engine.ts'
import { BUNDLED_REPOSITORY, bundledExtensions } from './extension-host/defaults.ts'
import { ExtensionHost, hostPage } from './extension-host/host.ts'
import { ExtensionError, type ExtensionManifest, parseRepository } from './extension-host/manifest.ts'
import { testExtension } from './extension-host/provider.ts'
import { FetchError, fetchJson, fetchText } from './http.ts'
import { annotationsForTorrentUrl } from './providers/archive.ts'
import { archiveJsonFetcher, buildProviders } from './providers/index.ts'
import { ProviderRegistry } from './providers/registry.ts'
import { ProviderSettingsStore, type SecretBox, SettingsError, validateRepositoryUrl } from './providers/settings.ts'
import { TorznabError, testTorznab } from './providers/torznab.ts'
import type { Playable } from './providers/types.ts'
import { isInfoHash, type LibraryEntry, LibraryError, SeedLibrary } from './seeding.ts'
import { parseSource, SourceError } from './source.ts'
import { type StreamServer, startStreamServer } from './stream-server.ts'
import { fetchTorrentFile } from './torrent-fetch.ts'

const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024
const MAX_HINT_LENGTH = 200
const MAX_QUERY_LENGTH = 200
const STATS_INTERVAL_MS = 1000
const REPOSITORY_MAX_BYTES = 512 * 1024
const EXTENSION_CODE_MAX_BYTES = 2 * 1024 * 1024
const EXTENSION_FETCH_TIMEOUT_MS = 20_000
/** Height of the renderer's top bar at 100% zoom. */
const TITLE_BAR_HEIGHT = 68

/**
 * Height of the native window-controls overlay: the top bar minus its bottom border line, so the theme's
 * border runs the full width under the minimise/maximise/close buttons instead of stopping at them.
 */
const overlayHeight = (zoom: number) => Math.round(TITLE_BAR_HEIGHT * zoom) - Math.ceil(zoom)
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** API keys are encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS, libsecret on Linux). */
const secretBox: SecretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: plain => safeStorage.encryptString(plain).toString('base64'),
  decrypt: cipher => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}

// Session-scoped cache: wiped on launch and on quit so streamed audio never piles up on disk.
const cacheDir = path.join(app.getPath('temp'), 'chomusuke-cache')

// Kept albums (seeded library); survives restarts.
const library = new SeedLibrary(path.join(app.getPath('userData'), 'library'))

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

/** Downloads a repository manifest and every extension's code it lists. */
async function downloadRepository(
  rawUrl: unknown
): Promise<{ url: string; installs: Array<{ manifest: ExtensionManifest; code: string }> }> {
  const { url, privateHttp } = validateRepositoryUrl(rawUrl)
  const origin = new URL(url).origin
  const policy = {
    timeoutMs: EXTENSION_FETCH_TIMEOUT_MS,
    // Plain http only for a repository on your own network, and only on its own origin.
    allowHttp: (target: URL) => privateHttp && target.origin === origin
  }
  try {
    const manifests = parseRepository(
      await fetchJson(url, { ...policy, maxBytes: REPOSITORY_MAX_BYTES }),
      url,
      privateHttp
    )
    const installs = await Promise.all(
      manifests.map(async manifest => ({
        manifest,
        code: await fetchText(manifest.codeUrl, {
          ...policy,
          maxBytes: EXTENSION_CODE_MAX_BYTES,
          accept: 'text/javascript, */*;q=0.5'
        })
      }))
    )
    return { url, installs }
  } catch (err) {
    if (err instanceof ExtensionError || err instanceof SettingsError) throw new SettingsError(err.message)
    if (err instanceof FetchError)
      throw new SettingsError(
        `Couldn’t download the repository (${err.kind === 'status' ? `HTTP ${err.status}` : err.kind}).`
      )
    throw err
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
    const album = await work()
    // Every user-opened album counts as played: streamed albums played recently are evicted last.
    void library.touch(album.infoHash).catch(() => {})
    return { ok: true, album }
  } catch (err) {
    if (err instanceof SourceError) return { ok: false, error: err.message }
    console.error('[ipc] unexpected load failure:', err)
    return { ok: false, error: 'Something went wrong while loading this torrent.' }
  }
}

/** Applies the saved sharing settings to the torrent client. */
function applySharing(torrents: TorrentEngine): void {
  const { enabled, uploadLimitKBps } = library.sharing
  torrents.setSharing(enabled, uploadLimitKBps * 1024)
}

/** Opens a kept album from the library folder (verifying what's already on disk) and fetches the rest. */
async function loadFromLibrary(torrents: TorrentEngine, infoHash: string): Promise<Album> {
  // Kept albums download in full; streamed ones only seed what they have (and fetch what's played).
  const kept = library.has(infoHash)
  const loaded = torrents.album(infoHash)
  if (loaded) {
    if (kept) torrents.keep(infoHash)
    return loaded
  }
  const entry = library.get(infoHash)
  if (!entry) throw new SourceError('That album isn’t in your library any more.')
  const data = await library.readTorrent(infoHash).catch(() => {
    throw new SourceError('This album’s torrent file is missing from your library.')
  })
  const parsed = await parseTorrent(data).catch(() => undefined)
  if (parsed?.infoHash !== infoHash) throw new SourceError('This album’s torrent file is damaged.')
  const album = await torrents.load(data, { title: entry.title, artist: entry.artist }, library.dataPath(infoHash))
  if (kept) torrents.keep(infoHash)
  return album
}

/** Starts seeding the library in the background (when the user hasn't opted out). */
async function seedLibrary(torrents: TorrentEngine): Promise<void> {
  const { enabled, seedLibrary: kept, seedStreamed: streamed } = library.sharing
  if (!enabled) return
  const entries = [...(kept ? library.list() : []), ...(streamed ? library.listStreamed() : [])]
  for (const entry of entries) {
    await loadFromLibrary(torrents, entry.infoHash).catch(err =>
      console.error(`[library] couldn't seed ${entry.infoHash}:`, err instanceof Error ? err.message : err)
    )
  }
}

function libraryView(torrents: TorrentEngine): LibraryView {
  const withActivity = (entry: LibraryEntry, progress: boolean) => {
    const activity = torrents.activity(entry.infoHash)
    return {
      ...entry,
      active: activity !== undefined,
      progress: progress ? activity?.progress : undefined,
      uploaded: activity?.uploaded ?? 0,
      numPeers: activity?.numPeers ?? 0,
      uploadSpeed: activity?.uploadSpeed ?? 0
    }
  }
  const streamed = library.listStreamed()
  return {
    sharing: library.sharing,
    items: library.list().map(entry => withActivity(entry, true)),
    streamed: streamed.map(entry => withActivity(entry, false)),
    streamedBytes: streamed.reduce((sum, entry) => sum + entry.size, 0),
    session: torrents.totals()
  }
}

async function toLibraryResponse(torrents: TorrentEngine, work: () => Promise<unknown>): Promise<LibraryResponse> {
  try {
    await work()
    return { ok: true, library: libraryView(torrents) }
  } catch (err) {
    if (err instanceof LibraryError) return { ok: false, error: err.message }
    console.error('[library]', err)
    return { ok: false, error: 'Something went wrong with your library.' }
  }
}

/** A file name that's safe on every OS, from a torrent's (untrusted) name. */
function safeFileName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) || !clean ? 'album' : clean
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
      return playableToAlbum(torrents, {
        kind: 'torrent',
        torrent: await fetchTorrentFile(source.url),
        hints,
        annotations
      })
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

  // Theme-driven window chrome: zoom (the "interface size" setting) and the title-bar overlay colours.
  ipcMain.handle('ui:set-window-appearance', (event, raw: unknown) => {
    assertTrustedSender(event)
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

  ipcMain.handle('torrent:details', (event, infoHash: unknown): TorrentDetails | null => {
    assertTrustedSender(event)
    if (!isInfoHash(infoHash)) return null
    return torrents.details(infoHash, library.has(infoHash)) ?? null
  })

  ipcMain.handle('torrent:save-file', async (event, infoHash: unknown): Promise<SaveTorrentResult> => {
    assertTrustedSender(event)
    const file = isInfoHash(infoHash) ? torrents.torrentFile(infoHash) : undefined
    if (!file || !mainWindow) return { ok: false, error: 'That torrent isn’t loaded any more.' }
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Save .torrent file',
      defaultPath: path.join(app.getPath('downloads'), `${safeFileName(file.name)}.torrent`),
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    try {
      await writeFile(picked.filePath, file.data)
      return { ok: true, path: picked.filePath }
    } catch {
      return { ok: false, error: 'Couldn’t save the file there.' }
    }
  })

  ipcMain.handle('torrent:copy-magnet', (event, infoHash: unknown): boolean => {
    assertTrustedSender(event)
    const magnet = isInfoHash(infoHash) ? torrents.magnet(infoHash) : undefined
    if (magnet) clipboard.writeText(magnet)
    return magnet !== undefined
  })

  ipcMain.handle('library:get', (event): LibraryView => {
    assertTrustedSender(event)
    return libraryView(torrents)
  })

  ipcMain.handle('library:keep', (event, infoHash: unknown, info: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(torrents, async () => {
      const kept = isInfoHash(infoHash) ? torrents.keep(infoHash) : undefined
      if (!kept) throw new LibraryError('That album isn’t loaded any more.')
      const details = typeof info === 'object' && info !== null ? (info as Record<string, unknown>) : {}
      await library.add(
        { title: details.title, artist: details.artist, coverUrl: details.coverUrl, infoHash, size: kept.size },
        kept.torrentFile
      )
    })
  })

  ipcMain.handle('library:remove', (event, infoHash: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(torrents, async () => {
      if (!isInfoHash(infoHash)) throw new LibraryError('That album isn’t in your library.')
      await library.remove(infoHash)
    })
  })

  ipcMain.handle('library:clear-streamed', event => {
    assertTrustedSender(event)
    return toLibraryResponse(torrents, () => library.clearStreamed())
  })

  ipcMain.handle('library:open', (event, infoHash: unknown) => {
    assertTrustedSender(event)
    return toResult(async () => {
      if (!isInfoHash(infoHash)) throw new SourceError('That album isn’t in your library.')
      return loadFromLibrary(torrents, infoHash)
    })
  })

  ipcMain.handle('sharing:set', (event, raw: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(torrents, async () => {
      const before = library.sharing
      await library.setSharing(raw)
      applySharing(torrents)
      const after = library.sharing
      // Turning seeding on starts it now rather than at the next launch.
      const seeds = (s: typeof after) => [s.enabled && s.seedLibrary, s.enabled && s.seedStreamed]
      const [keptNow, streamedNow] = seeds(after)
      const [keptBefore, streamedBefore] = seeds(before)
      if ((keptNow && !keptBefore) || (streamedNow && !streamedBefore)) void seedLibrary(torrents)
    })
  })

  ipcMain.handle('source:open-file', async event => {
    assertTrustedSender(event) // also guarantees mainWindow is set
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a .torrent file',
      properties: ['openFile'],
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    const filePath = picked.filePaths[0]
    if (picked.canceled || !filePath) return null
    return toResult(async () => {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_TORRENT_FILE_BYTES)
        throw new SourceError('That file is not a usable .torrent file.')
      return torrents.load(await readFile(filePath))
    })
  })
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
  await library.purge().catch(() => {})

  let torrents: TorrentEngine | null = null
  streamServer = await startStreamServer((infoHash, fileIndex) => torrents?.resolveFile(infoHash, fileIndex))
  torrents = engine = new TorrentEngine(cacheDir, streamServer.baseUrl, library.dataDir)
  applySharing(torrents)
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

  void seedLibrary(torrents)

  setInterval(() => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed() && !contents.isCrashed()) contents.send('torrent:stats', torrents.stats())
  }, STATS_INTERVAL_MS)
})
