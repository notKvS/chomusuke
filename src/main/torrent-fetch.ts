import { SourceError } from './source.ts'

const MAX_TORRENT_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 20_000

const tooBig = () => new SourceError('That .torrent file is too large.')

/**
 * Downloads a .torrent file over https only, following redirects manually so a redirect
 * can never downgrade to plain http, and capping the body size.
 */
export async function fetchTorrentFile(url: string): Promise<Uint8Array> {
  let current = new URL(url)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.5' }
      })
    } catch {
      throw new SourceError("Couldn't reach that link. Check your connection and the URL.")
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel()
      const location = res.headers.get('location')
      if (!location) throw new SourceError("Couldn't download the torrent file.")
      current = new URL(location, current)
      if (current.protocol !== 'https:') {
        throw new SourceError('That link redirects to an insecure (non-https) address.')
      }
      continue
    }

    if (!res.ok || !res.body) {
      await res.body?.cancel()
      throw new SourceError(`Couldn't download the torrent file (HTTP ${res.status}).`)
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_TORRENT_BYTES) {
      await res.body.cancel()
      throw tooBig()
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_TORRENT_BYTES) throw tooBig()
        chunks.push(value)
      }
    } catch (err) {
      await reader.cancel().catch(() => {})
      if (err instanceof SourceError) throw err
      throw new SourceError("Couldn't download the torrent file.")
    }
    return Buffer.concat(chunks)
  }
  throw new SourceError('That link redirected too many times.')
}
