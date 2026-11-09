// The cookies a plugin's sites set, kept in memory for as long as the app runs, so a plugin that signs in (manifest
// `"session": true`) stays signed in. The sandbox's own cookie store is never used: sites are cross-site to the
// sandbox page, so the browser wouldn't send cookies back anyway. The host adds them to the plugin's requests.

const MAX_COOKIES_PER_HOST = 50
const MAX_NAME = 200
const MAX_VALUE = 4096
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[^\s;,"\\\p{Cc}]*$/u

interface Stored {
  value: string
  /** ms since epoch; none for a cookie that lasts until the app closes */
  expires?: number
}

export class CookieJar {
  private readonly hosts = new Map<string, Map<string, Stored>>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Remembers (or deletes) the cookie from one Set-Cookie header sent by `host`. */
  store(host: string, setCookie: string): void {
    const [pair, ...attributes] = setCookie.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) return
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name.length > MAX_NAME || value.length > MAX_VALUE) return
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) return

    let expires: number | undefined
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split('=')
      const setting = rest.join('=').trim()
      switch (key.trim().toLowerCase()) {
        case 'max-age': {
          const seconds = Number(setting)
          if (Number.isFinite(seconds)) expires = this.now() + seconds * 1000
          break
        }
        case 'expires': {
          // Max-Age wins over Expires when both are there.
          const at = Date.parse(setting)
          if (expires === undefined && !Number.isNaN(at)) expires = at
          break
        }
      }
    }

    const cookies = this.hosts.get(host) ?? new Map<string, Stored>()
    if (value === '' || (expires !== undefined && expires <= this.now())) {
      cookies.delete(name)
    } else if (cookies.has(name) || cookies.size < MAX_COOKIES_PER_HOST) {
      cookies.set(name, { value, expires })
    }
    this.hosts.set(host, cookies)
  }

  /** Remembers cookies a browser window collected for `host` (e.g. after the user passed a site's bot check). */
  import(host: string, cookies: ReadonlyArray<{ name: string; value: string; expirationDate?: number }>): void {
    for (const { name, value, expirationDate } of cookies) {
      // Electron gives expirationDate in seconds; none means a session cookie.
      const expires = expirationDate === undefined ? '' : `; Expires=${new Date(expirationDate * 1000).toUTCString()}`
      this.store(host, `${name}=${value}${expires}`)
    }
  }

  /** The Cookie header for a request to `host`, if it has any cookies. */
  header(host: string): string | undefined {
    const cookies = this.hosts.get(host)
    if (!cookies) return undefined
    const now = this.now()
    const parts: string[] = []
    for (const [name, cookie] of cookies) {
      if (cookie.expires !== undefined && cookie.expires <= now) cookies.delete(name)
      else parts.push(`${name}=${cookie.value}`)
    }
    return parts.length > 0 ? parts.join('; ') : undefined
  }
}
