import parseTorrent, { toTorrentFile } from 'parse-torrent'

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false
  const [a, b] = parts
  return (
    a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  )
}

/**
 * Hosts on the user's own machine or network: loopback, private/link-local addresses (v4 and v6) and
 * LAN-style names (single-label, .local, .lan, .home.arpa, .internal). Used to decide where plain http is
 * tolerable and which addresses torrent metadata may not point us at.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (host.includes(':')) {
    if (host === '::1') return true
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
    if (dotted) return isPrivateIPv4(dotted[1])
    // WHATWG URL rewrites ::ffff:a.b.c.d as two hex groups.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (hex) {
      const [hi, lo] = [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16)]
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    return /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) // fc00::/7, fe80::/10
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPrivateIPv4(host)
  return host === 'localhost' || !host.includes('.') || /\.(local|lan|home\.arpa|internal)$/.test(host)
}

function publicUrl(raw: string): boolean {
  try {
    return !isPrivateHost(new URL(raw).hostname)
  } catch {
    return false
  }
}

/**
 * Rebuilds a magnet from a third party (indexer, extension) keeping only the info hash, name, public trackers
 * and public https web seeds. Drops peer addresses (x.pe) and everything else, so a result can't point the
 * torrent client at the user's own network.
 */
export function sanitizeThirdPartyMagnet(uri: string): string {
  const query = uri.slice(uri.indexOf('?') + 1)
  const kept: string[] = []
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=')
    const key = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase()
    let value = ''
    try {
      value = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1))
    } catch {
      continue
    }
    const keep =
      key === 'xt' ||
      key === 'dn' ||
      (key === 'tr' && /^(udp|https?|wss):\/\//i.test(value) && publicUrl(value)) ||
      (key === 'ws' && value.startsWith('https://') && publicUrl(value))
    if (keep) kept.push(pair)
  }
  return `magnet:?${kept.join('&')}`
}

/**
 * Removes web seeds and trackers that point at the user's own network from third-party .torrent files,
 * so opening a search result can't make the client probe LAN services. Web seeds must also be https.
 */
export async function stripPrivateEndpoints(torrent: Uint8Array): Promise<Uint8Array> {
  const parsed = await parseTorrent(torrent)
  parsed.urlList = (parsed.urlList ?? []).filter(url => url.startsWith('https://') && publicUrl(url))
  parsed.announce = (parsed.announce ?? []).filter(publicUrl)
  return toTorrentFile(parsed)
}
