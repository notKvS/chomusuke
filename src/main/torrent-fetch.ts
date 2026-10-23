import { FetchError, fetchCapped } from './http.ts'
import { SourceError } from './source.ts'

const MAX_TORRENT_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 20_000

/** Downloads a .torrent file (https only, size-capped) and maps failures to user-facing messages. */
export async function fetchTorrentFile(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    return await fetchCapped(url, {
      maxBytes: MAX_TORRENT_BYTES,
      timeoutMs: TIMEOUT_MS,
      signal,
      accept: 'application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.5'
    })
  } catch (err) {
    if (!(err instanceof FetchError)) throw err
    switch (err.kind) {
      case 'network':
        throw new SourceError("Couldn't reach that link. Check your connection and the URL.")
      case 'too-large':
        throw new SourceError('That .torrent file is too large.')
      case 'insecure-redirect':
        throw new SourceError('That link redirects to an insecure (non-https) address.')
      case 'too-many-redirects':
        throw new SourceError('That link redirected too many times.')
      case 'status':
        throw new SourceError(`Couldn't download the torrent file${err.status ? ` (HTTP ${err.status})` : ''}.`)
      default:
        throw new SourceError("Couldn't download the torrent file.")
    }
  }
}
