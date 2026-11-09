import { BrowserWindow, type Cookie, session } from 'electron'
import { logger } from '../log.ts'
import { hostAllowed } from './manifest.ts'

const log = logger('plugins')

/** What a plugin's error says when its site answered with a bot check instead of the page (see torrent-kit.ts). */
export const isBotCheckMessage = (message: string): boolean => /bot check/i.test(message)

/** How often the window looks for the cookie Cloudflare sets once a visitor has passed. */
const POLL_MS = 1000
const CLEARANCE_COOKIE = 'cf_clearance'

/**
 * Shows `url` in a normal window so the user can pass the site's bot check, and resolves with the site's cookies when
 * the window closes (or, for Cloudflare, as soon as it hands out its clearance cookie). Only `hosts` can be
 * navigated to; the check's own scripts load as page content. Nothing is kept: the partition is in memory.
 */
export function openBotCheckWindow(options: {
  url: string
  hosts: string[]
  title: string
  parent: BrowserWindow | null
}): Promise<Cookie[]> {
  const { url, hosts, title, parent } = options
  const partition = `bot-check-${Date.now()}`
  const ses = session.fromPartition(partition)
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  const win = new BrowserWindow({
    width: 560,
    height: 720,
    title: `${title} — pass the check, then close this window`,
    ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
    autoHideMenuBar: true,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  win.webContents.on('will-redirect', (event, target) => {
    try {
      if (!hostAllowed(new URL(target).hostname, hosts)) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  // The page title replaces ours otherwise.
  win.on('page-title-updated', event => event.preventDefault())

  return new Promise<Cookie[]>(resolve => {
    let done = false
    const collect = () => ses.cookies.get({ url }).catch(() => [])
    const finish = async () => {
      if (done) return
      done = true
      clearInterval(poll)
      const cookies = await collect()
      log.info(`bot check window closed with ${cookies.length} cookies for ${new URL(url).hostname}`)
      if (!win.isDestroyed()) win.destroy()
      void ses.clearStorageData().catch(() => {})
      resolve(cookies)
    }
    const poll = setInterval(() => {
      void collect().then(cookies => {
        if (cookies.some(c => c.name === CLEARANCE_COOKIE)) setTimeout(() => void finish(), POLL_MS)
      })
    }, POLL_MS)
    // The cookies are read before the window is gone (a destroyed window's session still answers, but be safe).
    win.on('close', event => {
      if (done) return
      event.preventDefault()
      void finish()
    })
    win.loadURL(url).catch(err => log.warn(`bot check page didn't load: ${String(err)}`))
  })
}
