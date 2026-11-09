import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, type Session, session } from 'electron'
import { logger } from '../log.ts'
import { openBotCheckWindow } from './challenge.ts'
import { CookieJar } from './cookie-jar.ts'
import { hostAllowed, PluginError, type PluginManifest } from './manifest.ts'
import type { PluginMethod, PluginRuntime } from './provider.ts'

const log = logger('plugins')

/**
 * Sandbox for plugin code. Each plugin gets:
 * - its own hidden, sandboxed, context-isolated window in an in-memory session partition, whose page only
 *   loads the code into a module Web Worker (no Node, no DOM access for the code, no access to our app);
 * - a network allow-list enforced by the session: https requests to the hosts its manifest declares, and
 *   nothing else (CORS headers are added for those hosts so the worker can read responses);
 * - a narrow message channel back to the main process (call → reply), with timeouts.
 */

export interface HostPage {
  /** URL of plugin-host.html (dev server or file://) */
  url: string
  /** Path of the compiled plugin-host preload */
  preload: string
}

const START_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 20_000
const MAX_ERROR = 300
/** Longest plugin console message kept in the log. */
const MAX_CONSOLE = 1000

const hostsByContents = new Map<number, PluginHost>()
let ipcWired = false
/** Development only: DevTools open on every plugin's sandbox window, including ones started later. */
let pluginDevTools = false

/** Toggles DevTools for all plugin sandbox windows (their workers' requests and errors show there). */
export function togglePluginDevTools(): void {
  pluginDevTools = !pluginDevTools
  for (const host of hostsByContents.values()) host.setDevTools(pluginDevTools)
}

function wireIpc(): void {
  if (ipcWired) return
  ipcWired = true
  // Only messages from a registered plugin window are accepted; anything else is ignored.
  ipcMain.on('ext:reply', (event, message: unknown) => hostsByContents.get(event.sender.id)?.receive(message))
}

/** (Re)applies the network policy; Electron replaces any listeners set by a previous start. */
function configureSession(ses: Session, hosts: string[], pageUrl: string, jar: CookieJar | null): void {
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

  // Why a plugin request failed (blocked by allow-list, DNS, reset, timeout…).
  ses.webRequest.onErrorOccurred(details => {
    log.warn(`network: ${details.method} ${details.url} → ${details.error}`)
  })

  // Requests to declared hosts go out without our page's Origin/Referer: some APIs (charts.youtube.com) answer 403
  // to a foreign origin such as the dev server's http://localhost. CORS for the worker is handled below.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      return callback({})
    }
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname, hosts)) return callback({})
    const requestHeaders = Object.fromEntries(
      Object.entries(details.requestHeaders).filter(([name]) => !/^(origin|referer)$/i.test(name))
    )
    // A plugin that signs in gets the cookies its site set (the sandbox can't send a Cookie header itself).
    const cookie = jar?.header(url.hostname)
    if (cookie) requestHeaders.Cookie = cookie
    callback({ requestHeaders })
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
      if (name.toLowerCase() === 'set-cookie') {
        // Never reaches the browser's own cookie store: only the jar (for plugins that sign in) keeps them.
        if (jar) for (const cookie of value) jar.store(url.hostname, cookie)
      } else if (!/^access-control-/i.test(name)) headers[name] = value
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

/**
 * Runs one plugin in a hidden, sandboxed window with an in-memory session that can only reach the plugin's
 * declared hosts over https. Started on the first call; a call that doesn't answer in time tears the window down
 * (stopping runaway code) and the next call starts it again.
 */
export class PluginHost implements PluginRuntime {
  private readonly manifest: PluginManifest
  private readonly code: string
  private readonly codeSha256: string
  private readonly page: HostPage
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private window: BrowserWindow | null = null
  private started: Promise<void> | null = null
  private onLoaded: { resolve: () => void; reject: (error: Error) => void } | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  /** Cookies for plugins that sign in (or whose site's bot check the user passed); null for the rest, which keep none. */
  private jar: CookieJar | null

  constructor(manifest: PluginManifest, code: string, codeSha256: string, page: HostPage) {
    this.manifest = manifest
    this.code = code
    this.codeSha256 = codeSha256
    this.page = page
    this.jar = manifest.session ? new CookieJar() : null
  }

  /** One in-memory partition per plugin *version*: a new code/hosts set never inherits old storage or policy. */
  private get partition(): string {
    return `plugin-${this.manifest.id}-${this.codeSha256.slice(0, 12)}`
  }

  async call(method: PluginMethod, args: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.start()
    const contents = this.window?.webContents
    if (!contents || contents.isDestroyed()) throw new PluginError(`${this.manifest.name} isn't running.`)
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
        reject(new PluginError(`${this.manifest.name} took too long to answer.`))
        // A worker stuck in a loop would burn a core forever; tear the sandbox down (the next call restarts it).
        this.dispose(`${method} didn't answer within ${CALL_TIMEOUT_MS / 1000} s`)
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

  /** Handles a message from this plugin's window. Shape is validated: the sender is untrusted code's host. */
  receive(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const { id, ok, value, error } = message as Record<string, unknown>
    if (typeof id !== 'number' || typeof ok !== 'boolean') return
    const failure = () => new PluginError(`${this.manifest.name}: ${String(error ?? 'failed').slice(0, MAX_ERROR)}`)
    if (id === 0) {
      // Load status of the plugin module.
      if (ok) this.onLoaded?.resolve()
      else {
        const err = failure()
        this.onLoaded?.reject(err)
        this.dispose(`its code failed to load: ${err.message}`)
      }
      return
    }
    const entry = this.pending.get(id)
    if (!entry) return
    if (ok) entry.resolve(value)
    else entry.reject(failure())
  }

  /**
   * Lets the user pass the plugin site's bot check in a real window, then keeps the cookies it earned for the
   * plugin's next requests. Returns how many cookies were kept.
   */
  async passBotCheck(origin: string, parent: BrowserWindow | null): Promise<number> {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname, this.manifest.hosts)) {
      throw new PluginError(`${this.manifest.name} doesn't declare ${url.hostname}.`)
    }
    const cookies = await openBotCheckWindow({
      url: url.toString(),
      hosts: this.manifest.hosts,
      title: this.manifest.name,
      parent
    })
    // A plugin that doesn't sign in has no jar until now: it only starts keeping cookies once the user passed a check.
    this.jar ??= new CookieJar()
    this.jar.import(url.hostname, cookies)
    // A sandbox that is already running holds the old (jar-less) policy; reapply it with the jar.
    if (this.window && !this.window.isDestroyed()) {
      configureSession(session.fromPartition(this.partition), this.manifest.hosts, this.page.url, this.jar)
    }
    return cookies.length
  }

  setDevTools(open: boolean): void {
    const contents = this.window?.webContents
    if (!contents || contents.isDestroyed()) return
    if (open) contents.openDevTools({ mode: 'detach', title: `Plugin: ${this.manifest.name}` })
    else contents.closeDevTools()
  }

  /** Stops the sandbox; `reason` is logged when it's a problem rather than a plain shutdown. */
  dispose(reason?: string): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    for (const entry of this.pending.values()) entry.reject(new PluginError(`${this.manifest.name} stopped.`))
    this.pending.clear()
    if (this.window && !this.window.isDestroyed()) {
      if (reason) log.warn(`${this.manifest.id}: stopping the sandbox: ${reason}`)
      else log.debug(`${this.manifest.id}: sandbox closed`)
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
    const { id, version } = this.manifest
    const startedAt = performance.now()
    log.info(`${id} ${version}: starting its sandbox`)
    wireIpc()
    const partition = this.partition // no "persist:" prefix → in-memory: no cookies or storage on disk
    configureSession(session.fromPartition(partition), this.manifest.hosts, this.page.url, this.jar)

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
    if (pluginDevTools) this.setDevTools(true)
    window.webContents.on('render-process-gone', (_event, details) =>
      this.dispose(`its process ended (${details.reason})`)
    )
    window.webContents.on('did-finish-load', () =>
      window.webContents.send('ext:load', { code: this.code, hosts: this.manifest.hosts })
    )
    // What the plugin prints (console.log, uncaught errors) is the best clue to why a source fails.
    window.webContents.on('console-message', ({ level, message }) => {
      const text = `${id}: ${message.slice(0, MAX_CONSOLE)}`
      if (level === 'error') log.warn(text)
      else log.debug(text)
    })

    this.started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose(`it didn't start within ${START_TIMEOUT_MS / 1000} s`)
        reject(new PluginError(`${this.manifest.name} failed to start.`))
      }, START_TIMEOUT_MS)
      this.startTimer = timer
      this.onLoaded = {
        resolve: () => {
          clearTimeout(timer)
          log.info(`${id}: running after ${Math.round(performance.now() - startedAt)} ms`)
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

/** Where the plugin sandbox page and its preload are: the dev server while developing, the build otherwise. */
export function hostPage(rendererUrl: string | undefined, isPackaged: boolean, mainDir: string): HostPage {
  const url =
    !isPackaged && rendererUrl
      ? new URL('plugin-host.html', rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`).toString()
      : pathToFileURL(path.join(mainDir, '../renderer/plugin-host.html')).toString()
  return { url, preload: path.join(mainDir, '../preload/plugin-host.cjs') }
}
