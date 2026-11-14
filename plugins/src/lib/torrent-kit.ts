// Helpers shared by the tracker templates: request helpers, mirror selection, HTML/XML scraping without a DOM
// (the sandbox is a Web Worker, so there is no DOMParser), release-name parsing and magnet building.
import type { Options, TorrentResult } from '../sdk.ts'

/** Well-known public trackers added to magnets that only carry an info hash. */
export const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'https://tracker.opentrackr.org:443/announce'
]

const INFO_HASH = /^[a-f0-9]{40}$/i

export function magnet(hash: string, name: string, trackers: readonly string[] = PUBLIC_TRACKERS): string | undefined {
  if (!INFO_HASH.test(hash)) return undefined
  const parts = [`xt=urn:btih:${hash.toLowerCase()}`, `dn=${encodeURIComponent(name)}`]
  for (const tracker of trackers) parts.push(`tr=${encodeURIComponent(tracker)}`)
  return `magnet:?${parts.join('&')}`
}

/**
 * The site origin to use: the `mirror` option when it names one of the hosts the plugin declared, otherwise
 * the first one. The sandbox blocks undeclared hosts anyway; this just turns a typo into a clear message.
 */
export function siteOrigin(options: Options, mirrors: readonly string[]): string {
  const raw = typeof options.mirror === 'string' ? options.mirror.trim().toLowerCase() : ''
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host) return `https://${mirrors[0]}`
  if (!mirrors.includes(host)) throw new Error(`“${host}” isn’t one of this plugin’s mirrors: ${mirrors.join(', ')}`)
  return `https://${host}`
}

/** Cloudflare / DDoS-Guard interstitials come back as 403/503 HTML pages that scrapers can't get past. */
function challenged(res: Response, body: string): boolean {
  return (res.status === 403 || res.status === 503) && /cf-chl|challenge-platform|Just a moment|ddos-guard/i.test(body)
}

/** Per request, so one slow page can't use up the app's 20 s budget for the whole call. */
const REQUEST_TIMEOUT_MS = 10_000

async function request(url: string | URL, site: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init })
  } catch {
    throw new Error(`Couldn’t reach ${site}. It may be down or blocked on your network — try another mirror.`)
  }
}

/** `encoding` is the page's character set when it isn't UTF-8 (e.g. "windows-1251"). */
export async function getText(
  url: string | URL,
  site: string,
  init?: RequestInit,
  encoding = 'utf-8'
): Promise<string> {
  const res = await request(url, site, init)
  const body = encoding === 'utf-8' ? await res.text() : new TextDecoder(encoding).decode(await res.arrayBuffer())
  if (challenged(res, body)) {
    throw new Error(
      `${site} is showing a bot check (Cloudflare). Try another mirror, or reach it through a Torznab indexer that can pass the check.`
    )
  }
  if (!res.ok) throw new Error(`${site} answered ${res.status}`)
  return body
}

export async function getJson<T>(url: string | URL, site: string, init?: RequestInit): Promise<T> {
  const body = await getText(url, site, init)
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`${site} sent something that isn’t JSON — its API may have changed.`)
  }
}

/** Runs `task` over `items` with at most `limit` in flight; failed items are dropped. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R | undefined>
): Promise<R[]> {
  const results: Array<R | undefined> = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = await task(items[index])
      } catch {
        results[index] = undefined
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results.filter((r): r is R => r !== undefined)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Visible text of an HTML fragment. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Contents of each `<tag …>…</tag>` (non-nested), e.g. table rows or cells. */
export function elements(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  return [...html.matchAll(pattern)].map(m => m[1])
}

/** Text of `<name>` inside an XML fragment (CDATA unwrapped, entities decoded). */
export function xmlText(xml: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'i').exec(xml)
  if (!match) return undefined
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1])
  return cdata ? cdata[1].trim() : decodeEntities(match[1]).trim()
}

const POWERS: Record<string, number> = { '': 0, K: 1, M: 2, G: 3, T: 4 }

/** "1.2 GB", "700.5 MiB", "1,024 KB" → bytes (torrent sites mean binary units even when they write GB). */
export function parseSize(text: string): number | undefined {
  const match = /([\d.,]+)\s*([KMGT]?)i?B\b/i.exec(text)
  if (!match) return undefined
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? Math.round(value * 1024 ** POWERS[match[2].toUpperCase()]) : undefined
}

export const parseCount = (text: string | undefined): number | undefined => {
  const n = Number((text ?? '').replace(/[^\d]/g, ''))
  return text && Number.isFinite(n) ? n : undefined
}

const FORMAT_TAGS: Array<[RegExp, string]> = [
  [/\bflac\b/i, 'FLAC'],
  [/\balac\b/i, 'ALAC'],
  [/\b(24[ -]?bit|24[-/](?:44|48|88|96|176|192)(?:\.\d)?(?:\s?k?hz)?|hi-?res)\b/i, 'Hi-Res'],
  [/\b(lossless|wav|ape)\b/i, 'Lossless'],
  [/\bmp3\b/i, 'MP3'],
  [/\b320\s?(?:kbps|k)?\b/i, '320'],
  [/\bV0\b/, 'V0'],
  [/\b(aac|m4a)\b/i, 'AAC'],
  [/\bopus\b/i, 'Opus'],
  [/\bdiscography\b/i, 'Discography'],
  [/\bvinyl\b/i, 'Vinyl']
]

/**
 * Best-effort split of a scene/uploader release name into artist, title, year and format tags:
 * "Artist - Album (2021) [FLAC 24-96]" → { artist: "Artist", title: "Album", year: "2021", tags: ["FLAC", "Hi-Res"] }.
 */
export function parseRelease(name: string): Pick<TorrentResult, 'title' | 'artist' | 'year' | 'tags'> {
  let text = name.replace(/_/g, ' ').trim()
  if (!text.includes(' ') && (text.match(/\./g) ?? []).length >= 2) text = text.replace(/\.(?!\w{2,4}$)/g, ' ')
  const tags = [...new Set(FORMAT_TAGS.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag))].slice(0, 4)
  // Prefer a bracketed year ("(2021)", "[2021.03.05]") over one that might be part of the title.
  const year = /[([{]((?:19|20)\d{2})(?!\d)/.exec(text) ?? /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(text)
  // Drop leading and trailing bracketed groups ("[FLAC]", "(2021)", "{Web}") and trailing format words.
  let core = text
  for (let previous = ''; previous !== core; ) {
    previous = core
    core = core
      .replace(/^\s*[[({][^\])}]*[\])}]\s*/, '')
      .replace(/\s*[[({][^\])}]*[\])}]\s*$/, '')
      .replace(/[\s-]+(?:FLAC|MP3|320|V0|AAC|WEB|CD|24bit|16bit|Lossless|Hi-?Res)\s*$/i, '')
      .trim()
  }
  if (!core) core = text
  const dash = /\s[-–—]\s/.exec(core)
  const [artist, title] = dash
    ? [core.slice(0, dash.index).trim(), core.slice(dash.index + dash[0].length).trim()]
    : [undefined, core]
  return { title: title || core, artist: artist || undefined, year: year?.[1], tags }
}

/** windows-1251 bytes for the characters outside ASCII and the basic Cyrillic letters (А–я). */
const CP1251_EXTRA = new Map<number, number>([
  [0x401, 0xa8], // Ё
  [0x451, 0xb8], // ё
  [0x404, 0xaa], // Є
  [0x454, 0xba], // є
  [0x406, 0xb2], // І
  [0x456, 0xb3], // і
  [0x407, 0xaf], // Ї
  [0x457, 0xbf], // ї
  [0x490, 0xa5], // Ґ
  [0x491, 0xb4], // ґ
  [0x2116, 0xb9], // №
  [0xa0, 0xa0],
  [0xab, 0xab], // «
  [0xbb, 0xbb], // »
  [0xa9, 0xa9], // ©
  [0xb0, 0xb0], // °
  [0xb1, 0xb1], // ±
  [0xb7, 0xb7], // ·
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2026, 0x85] // …
])

function cp1251Byte(char: string): number {
  const code = char.codePointAt(0) ?? 0x3f
  if (code < 0x80) return code
  if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
  const extra = CP1251_EXTRA.get(code)
  if (extra !== undefined) return extra
  // "é" → "e"; anything else the encoding doesn't have becomes "?".
  const base = char.normalize('NFD').replace(/\p{M}+/gu, '')
  return base !== char && base.length === 1 && base.charCodeAt(0) < 0x80 ? base.charCodeAt(0) : 0x3f
}

/**
 * Text as a form or query-string value for a site that reads windows-1251 (RuTracker): each character as its
 * windows-1251 byte, percent-encoded, with spaces as "+".
 */
export function percentEncodeCp1251(text: string): string {
  let out = ''
  for (const char of text.normalize('NFC')) {
    const byte = cp1251Byte(char)
    if (byte === 0x20) out += '+'
    else if (byte < 0x80 && /[A-Za-z0-9\-_.~]/.test(String.fromCharCode(byte))) out += String.fromCharCode(byte)
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** Search terms safe to put in a URL path segment. */
export function cleanQuery(query: string): string {
  return query
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}'&.+-]+/gu, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * The download link on a torrent's detail page: its magnet link if it has one, otherwise a magnet built from the
 * info hash in an itorrents `.torrent` link.
 */
export function detailMagnet(html: string, name: string): string | undefined {
  const direct = /href="(magnet:[^"]+)"/i.exec(html)?.[1]
  if (direct) return direct.replace(/&amp;/g, '&')
  const hash = /href="[^"]*itorrents[^"]*\/torrent\/([a-f0-9]{40})\.torrent/i.exec(html)?.[1]
  return hash ? magnet(hash, name) : undefined
}
