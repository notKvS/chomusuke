export type ParsedSource = { kind: 'magnet'; uri: string } | { kind: 'url'; url: string }

/** Errors whose message is safe and meant to be shown to the user. */
export class SourceError extends Error {
  name = 'SourceError'
}

const MAX_SOURCE_LENGTH = 8192
// WebTorrent fetches xs/as ("exact"/"acceptable source") URLs itself over http with no size cap,
// bypassing fetchTorrentFile's https-only, size-limited download — so they are stripped.
const STRIPPED_MAGNET_PARAMS = new Set(['xs', 'as'])
const INFO_HASH_HEX = /^[a-f0-9]{40}$/i
const INFO_HASH_BASE32 = /^[a-z2-7]{32}$/i

function decodeKey(pair: string): string {
  const key = pair.split('=', 1)[0]
  try {
    return decodeURIComponent(key).toLowerCase()
  } catch {
    return key.toLowerCase()
  }
}

/** Validates user-pasted input against an allow-list of supported torrent sources. */
export function parseSource(input: unknown): ParsedSource {
  if (typeof input !== 'string') throw new SourceError('Paste a magnet link or a .torrent URL.')
  const value = input.trim()
  if (!value) throw new SourceError('Paste a magnet link or a .torrent URL.')
  if (value.length > MAX_SOURCE_LENGTH) throw new SourceError('That link is too long.')

  if (INFO_HASH_HEX.test(value)) {
    return { kind: 'magnet', uri: `magnet:?xt=urn:btih:${value.toLowerCase()}` }
  }

  if (/^magnet:\?/i.test(value)) {
    const params = new URLSearchParams(value.slice(value.indexOf('?') + 1))
    const hasInfoHash = params.getAll('xt').some(xt => {
      const hash = /^urn:btih:(.+)$/i.exec(xt)?.[1] ?? ''
      return INFO_HASH_HEX.test(hash) || INFO_HASH_BASE32.test(hash)
    })
    if (!hasInfoHash) throw new SourceError("That magnet link doesn't contain a valid info hash.")
    // Filter the raw pairs so every kept parameter keeps its original encoding.
    const kept = value
      .slice(value.indexOf('?') + 1)
      .split('&')
      .filter(pair => !STRIPPED_MAGNET_PARAMS.has(decodeKey(pair)))
    return { kind: 'magnet', uri: `magnet:?${kept.join('&')}` }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SourceError('Paste a magnet link or a .torrent URL.')
  }
  // https only: a tampered .torrent over plain http could point us at an arbitrary swarm.
  if (url.protocol !== 'https:') throw new SourceError('Only https:// links to .torrent files are supported.')
  if (url.username || url.password) throw new SourceError('Links with embedded credentials are not supported.')
  return { kind: 'url', url: url.toString() }
}
