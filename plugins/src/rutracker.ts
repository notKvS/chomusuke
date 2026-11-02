// RuTracker: the music forums of the big Russian tracker, which only shows torrents to signed-in members. The plugin
// signs in with the username and password the user enters in its setup window (stored encrypted; the manifest's
// "session" lets the app keep the login cookie while it runs), searches the tracker, and takes each result's magnet
// link from its topic page (search pages list no info hashes), for the top rows only.
// Template: off by default. Written from how the site is known to work and NOT tested against the live site, so the
// markup patterns below are the first thing to check if it finds nothing. Pages are windows-1251, not UTF-8.

import {
  cleanQuery,
  elements,
  getText,
  mapLimit,
  parseCount,
  parseRelease,
  parseSize,
  percentEncodeCp1251,
  siteOrigin,
  stripTags
} from './lib/torrent-kit.ts'
import type { Options, ProviderPlugin, TorrentResult } from './sdk.ts'

/** Must match "hosts" in index.json. */
export const MIRRORS = ['rutracker.org', 'rutracker.net', 'rutracker.nl']
const SITE = 'RuTracker'
const ENCODING = 'windows-1251'
/** Topic pages fetched per search (one request each). */
const RESOLVE = 15
/** "Вход" in windows-1251: the login form's submit button must be sent for the site to accept the form. */
const LOGIN_BUTTON = '%C2%F5%EE%E4'

export interface Row {
  id: string
  title: string
  forum: string
  size?: number
  seeders?: number
  leechers?: number
}

/** Forums outside music (films, games, software…) have none of these words in their names. */
const MUSIC_FORUM =
  /музык|lossless|\bmp3\b|flac|\baac\b|саундтрек|soundtrack|\bost\b|\brock\b|\bрок\b|\bpop\b|\bпоп\b|jazz|джаз|blues|блюз|metal|метал|punk|панк|hip-?hop|хип-?хоп|рэп|r'?n'?b|reggae|регги|folk|фолк|country|шансон|электрон|electronic|trance|techno|house|ambient|dubstep|k-?pop|j-?pop|latin|classical|классическ|opera|опер|vocal|вокал|альтернатив|indie|этническ|new age|шоу-?хит|\bsoul\b|\bfunk\b|диско|disco|ретро/i

export const isMusicForum = (name: string): boolean => MUSIC_FORUM.test(name)

/** The sign-in form: shown to anyone who isn't signed in, including after a wrong password. */
export const isLoginPage = (html: string): boolean => /name="login_username"/i.test(html)

/** Rows of a search results page (tracker.php): topic id, title, forum, size, seeders, leechers. */
export function parseListing(html: string): Row[] {
  return elements(html, 'tr').flatMap(row => {
    const topic = /<a[^>]*href="viewtopic\.php\?t=(\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(row)
    if (!topic) return []
    const forum = /<a[^>]*href="(?:tracker|viewforum)\.php\?f=\d+"[^>]*>([\s\S]*?)<\/a>/i.exec(row)
    // The size cell carries the exact byte count; its text ("1.2 GB ↓") is the fallback.
    const sizeCell = /<td[^>]*tor-size[^>]*>([\s\S]*?)<\/td>/i.exec(row)
    const bytes = /data-ts_text="(\d+)"/i.exec(sizeCell?.[0] ?? '')?.[1]
    const seeders = /<b[^>]*class="[^"]*seed[^"]*"[^>]*>\s*(\d+)\s*<\/b>/i.exec(row)?.[1]
    const leechers = /<td[^>]*class="[^"]*leech[^"]*"[^>]*>\s*(?:<b>)?\s*(\d+)/i.exec(row)?.[1]
    return [
      {
        id: topic[1],
        title: stripTags(topic[2]),
        forum: stripTags(forum?.[1] ?? ''),
        size: bytes ? Number(bytes) : sizeCell ? parseSize(stripTags(sizeCell[1])) : undefined,
        seeders: parseCount(seeders),
        leechers: parseCount(leechers)
      }
    ]
  })
}

/** The magnet link on a topic page (members only). */
export function parseMagnet(html: string): string | undefined {
  const href = /href="(magnet:\?xt=urn:btih:[^"]+)"/i.exec(html)?.[1]
  return href?.replace(/&amp;/g, '&')
}

/** The sign-in form as the site expects it: windows-1251, with the submit button. */
export function loginBody(username: string, password: string): string {
  return `login_username=${percentEncodeCp1251(username)}&login_password=${percentEncodeCp1251(password)}&login=${LOGIN_BUTTON}`
}

const page = (url: URL, init?: RequestInit) => getText(url, SITE, init, ENCODING)

function credentials(options: Options): { username: string; password: string } {
  const username = typeof options.username === 'string' ? options.username.trim() : ''
  const password = typeof options.password === 'string' ? options.password : ''
  if (!username || !password) throw new Error('Enter your RuTracker username and password first (the edit button).')
  return { username, password }
}

async function signIn(origin: string, options: Options): Promise<void> {
  const { username, password } = credentials(options)
  const html = await page(new URL('/forum/login.php', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody(username, password)
  })
  if (!isLoginPage(html)) return
  throw new Error(
    /cap_sid|captcha|капч/i.test(html)
      ? 'RuTracker is asking for a captcha. Sign in once on its website in a browser, then try again.'
      : 'RuTracker didn’t accept that username and password.'
  )
}

/** A search results page, signing in first if the site shows the login form instead. */
async function searchPage(origin: string, query: string, options: Options): Promise<string> {
  credentials(options)
  // o=10 & s=2: most seeded first.
  const url = new URL(`/forum/tracker.php?nm=${percentEncodeCp1251(query)}&o=10&s=2`, origin)
  let html = await page(url)
  if (isLoginPage(html)) {
    await signIn(origin, options)
    html = await page(url)
    if (isLoginPage(html)) throw new Error('RuTracker still shows its login page after signing in.')
  }
  return html
}

async function resolve(origin: string, rows: Row[]): Promise<TorrentResult[]> {
  return mapLimit(rows.slice(0, RESOLVE), 4, async row => {
    const link = parseMagnet(await page(new URL(`/forum/viewtopic.php?t=${row.id}`, origin)))
    if (!link) return undefined
    const release = parseRelease(row.title)
    const kind = /lossless/i.test(row.forum) ? 'Lossless' : /mp3/i.test(row.forum) ? 'MP3' : undefined
    return {
      ...release,
      link,
      size: row.size,
      seeders: row.seeders,
      leechers: row.leechers,
      tags: [...new Set([...(release.tags ?? []), ...(kind ? [kind] : [])])].slice(0, 4)
    }
  })
}

const plugin: ProviderPlugin = {
  async test({ options }) {
    const origin = siteOrigin(options, MIRRORS)
    credentials(options)
    await signIn(origin, options)
    if (parseListing(await searchPage(origin, 'flac', options)).length === 0) {
      throw new Error('RuTracker answered, but the page had no torrents — the site layout may have changed.')
    }
    return true
  },

  async search({ query, options }) {
    const q = cleanQuery(query)
    if (!q) return []
    const origin = siteOrigin(options, MIRRORS)
    let rows = parseListing(await searchPage(origin, q, options))
    if (options.musicOnly !== false) rows = rows.filter(row => isMusicForum(row.forum))
    return resolve(origin, rows)
  }
}

export default plugin
