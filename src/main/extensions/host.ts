import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, type Session, session } from 'electron'
import { ExtensionError, type ExtensionManifest, hostAllowed } from './manifest.ts'
import type { ExtensionMethod, ExtensionRuntime } from './provider.ts'

/**
 * Sandbox for extension code. Each extension gets:
 * - its own hidden, sandboxed, context-isolated window in an in-memory session partition, whose page only
 *   loads the code into a module Web Worker (no Node, no DOM access for the code, no access to our app);
 * - a network allow-list enforced by the session: https requests to the hosts its manifest declares, and
 *   nothing else (CORS headers are added for those hosts so the worker can read responses);
 * - a narrow message channel back to the main process (call → reply), with timeouts.
 */

export interface HostPage {
  /** URL of ext-host.html (dev server or file://) */
  url: string
  /** Path of the compiled ext-host preload */
  preload: string
}

const START_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 20_000
const MAX_ERROR = 300

const hostsByContents = new Map<number, ExtensionHost>()
let ipcWired = false

function wireIpc(): void {
  if (ipcWired) return
  ipcWired = true
  // Only messages from a registered extension window are accepted; anything else is ignored.
  ipcMain.on('ext:reply', (event, message: unknown) => hostsByContents.get(event.sender.id)?.receive(message))
}

/** (Re)applies the network policy; Electron replaces any listeners set by a previous start. */
function configureSession(ses: Session, hosts: string[], pageUrl: string): void {
  const page = new URL(pageUrl)
  const pageDir = page.protocol === 'file:' ? new URL('.', page).toString() : null

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  ses.webRequest.onBeforeRequest((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      return callback({ cancel: true })
    }
    const ownPage =
      url.protocol === 'blob:' ||
      (pageDir !== null && details.url.startsWith(pageDir)) ||
      (pageDir === null && url.host === page.host && (url.protocol === page.protocol || url.protocol === 'ws:'))
    const declared = url.protocol === 'https:' && url.port === '' && hostAllowed(url.hostname, hosts)
    callback({ cancel: !(ownPage || declared) })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      return callback({})
    }
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname, hosts)) return callback({})
    const headers: Record<string, string[]> = {}
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!/^access-control-/i.test(name) && name.toLowerCase() !== 'set-cookie') headers[name] = value
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS']
    callback({
      responseHeaders: headers,
      ...(details.method === 'OPTIONS' && { statusLine: 'HTTP/1.1 204 No Content' })
    })
  })
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class ExtensionHost implements ExtensionRuntime {
  private readonly manifest: ExtensionManifest
  private readonly code: string
  private readonly codeSha256: string
  private readonly page: HostPage
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private window: BrowserWindow | null = null
  private started: Promise<void> | null = null
  private onLoaded: { resolve: () => void; reject: (error: Error) => void } | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(manifest: ExtensionManifest, code: string, codeSha256: string, page: HostPage) {
    this.manifest = manifest
    this.code = code
    this.codeSha256 = codeSha256
    this.page = page
  }

  /** One in-memory partition per extension *version*: a new code/hosts set never inherits old storage or policy. */
  private get partition(): string {
    return `ext-${this.manifest.id}-${this.codeSha256.slice(0, 12)}`
  }

  async call(method: ExtensionMethod, args: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.start()
    const contents = this.window?.webContents
    if (!contents || contents.isDestroyed()) throw new ExtensionError(`${this.manifest.name} isn't running.`)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        finish()
        reject(signal?.reason ?? new Error('Aborted'))
      }
      const timer = setTimeout(() => {
        finish()
        reject(new ExtensionError(`${this.manifest.name} took too long to answer.`))
        // A worker stuck in a loop would burn a core forever; tear the sandbox down (the next call restarts it).
        this.dispose()
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: value => {
          finish()
          resolve(value)
        },
        reject: error => {
          finish()
          reject(error)
        },
        timer
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      contents.send('ext:call', { id, method, args })
    })
  }

  /** Handles a message from this extension's window. Shape is validated: the sender is untrusted code's host. */
  receive(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const { id, ok, value, error } = message as Record<string, unknown>
    if (typeof id !== 'number' || typeof ok !== 'boolean') return
    const failure = () => new ExtensionError(`${this.manifest.name}: ${String(error ?? 'failed').slice(0, MAX_ERROR)}`)
    if (id === 0) {
      // Load status of the extension module.
      if (ok) this.onLoaded?.resolve()
      else {
        this.onLoaded?.reject(failure())
        this.dispose()
      }
      return
    }
    const entry = this.pending.get(id)
    if (!entry) return
    if (ok) entry.resolve(value)
    else entry.reject(failure())
  }

  dispose(): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    for (const entry of this.pending.values()) entry.reject(new ExtensionError(`${this.manifest.name} stopped.`))
    this.pending.clear()
    if (this.window && !this.window.isDestroyed()) {
      hostsByContents.delete(this.window.webContents.id)
      this.window.destroy()
      void session
        .fromPartition(this.partition)
        .clearStorageData()
        .catch(() => {})
    }
    this.window = null
    this.started = null
  }

  private start(): Promise<void> {
    if (this.started) return this.started
    wireIpc()
    const partition = this.partition // no "persist:" prefix → in-memory: no cookies or storage on disk
    configureSession(session.fromPartition(partition), this.manifest.hosts, this.page.url)

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        preload: this.page.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
        images: false
      }
    })
    this.window = window
    hostsByContents.set(window.webContents.id, this)
    window.webContents.on('render-process-gone', () => this.dispose())
    window.webContents.on('did-finish-load', () =>
      window.webContents.send('ext:load', { code: this.code, hosts: this.manifest.hosts })
    )

    this.started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose()
        reject(new ExtensionError(`${this.manifest.name} failed to start.`))
      }, START_TIMEOUT_MS)
      this.startTimer = timer
      this.onLoaded = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      }
    })
    this.started.catch(() => {}) // surfaced to callers of call()
    void window.loadURL(this.page.url)
    return this.started
  }
}

export function hostPage(rendererUrl: string | undefined, isPackaged: boolean, mainDir: string): HostPage {
  const url =
    !isPackaged && rendererUrl
      ? new URL('ext-host.html', rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`).toString()
      : pathToFileURL(path.join(mainDir, '../renderer/ext-host.html')).toString()
  return { url, preload: path.join(mainDir, '../preload/ext-host.cjs') }
}
