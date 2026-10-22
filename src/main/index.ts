import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { TorrentEngine } from './engine.ts'
import { parseSource, SourceError } from './source.ts'
import { startStreamServer, type StreamServer } from './stream-server.ts'
import { fetchTorrentFile } from './torrent-fetch.ts'
import type { Album, LoadResult, SourceHints } from '../shared/types.ts'

const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024
const MAX_HINT_LENGTH = 200
const STATS_INTERVAL_MS = 1000

// Session-scoped cache: wiped on launch and on quit so streamed audio never piles up on disk.
const cacheDir = path.join(app.getPath('temp'), 'chomusuke-cache')

let mainWindow: BrowserWindow | null = null
let engine: TorrentEngine | null = null
let streamServer: StreamServer | null = null

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

async function toResult(work: () => Promise<Album>): Promise<LoadResult> {
  try {
    return { ok: true, album: await work() }
  } catch (err) {
    if (err instanceof SourceError) return { ok: false, error: err.message }
    console.error('[ipc] unexpected load failure:', err)
    return { ok: false, error: 'Something went wrong while loading this torrent.' }
  }
}

function registerIpc(torrents: TorrentEngine): void {
  ipcMain.handle('source:load', (event, rawSource: unknown, rawHints: unknown) => {
    assertTrustedSender(event)
    return toResult(async () => {
      const source = parseSource(rawSource)
      const hints = sanitizeHints(rawHints)
      if (source.kind === 'magnet') return torrents.load(source.uri, hints)
      return torrents.load(await fetchTorrentFile(source.url), hints)
    })
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

  let torrents: TorrentEngine | null = null
  streamServer = await startStreamServer((infoHash, fileIndex) => torrents?.resolveFile(infoHash, fileIndex))
  torrents = engine = new TorrentEngine(cacheDir, streamServer.baseUrl)
  registerIpc(torrents)

  mainWindow = createWindow()
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] renderer gone:', details.reason)
    if (details.reason !== 'clean-exit') mainWindow?.reload()
  })

  setInterval(() => {
    const contents = mainWindow?.webContents
    if (contents && !contents.isDestroyed() && !contents.isCrashed()) contents.send('torrent:stats', torrents.stats())
  }, STATS_INTERVAL_MS)
})
