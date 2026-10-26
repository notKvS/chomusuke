export type FetchErrorKind =
  | 'network'
  | 'status'
  | 'too-large'
  | 'insecure-redirect'
  | 'blocked-host'
  | 'too-many-redirects'
  | 'invalid-json'
  | 'unexpected-magnet'

export class FetchError extends Error {
  name = 'FetchError'
  readonly kind: FetchErrorKind
  readonly status?: number

  constructor(kind: FetchErrorKind, message: string, status?: number) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

export interface CappedFetchOptions {
  maxBytes: number
  timeoutMs: number
  accept?: string
  /** Every hop (including redirects) must land on an allowed host. */
  allowHost?: (hostname: string) => boolean
  /** Plain http is refused unless this approves the URL (e.g. a self-hosted indexer on the LAN). */
  allowHttp?: (url: URL) => boolean
  signal?: AbortSignal
}

export type BodyOrMagnet = { kind: 'body'; body: Uint8Array } | { kind: 'magnet'; uri: string }

const MAX_REDIRECTS = 5

/**
 * GET with a strict policy: https only (unless allowHttp approves the host), redirects followed manually so
 * none can downgrade or leave the allowed hosts, body capped at `maxBytes`. A redirect to a magnet: link
 * (how indexers hand out magnet-only releases) is returned instead of followed.
 */
export async function fetchBodyOrMagnet(url: string | URL, options: CappedFetchOptions): Promise<BodyOrMagnet> {
  const { maxBytes, timeoutMs, accept, allowHost, allowHttp, signal } = options
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  let current = new URL(url)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const plainHttpAllowed = current.protocol === 'http:' && allowHttp?.(current) === true
    if (current.protocol !== 'https:' && !plainHttpAllowed) {
      throw new FetchError('insecure-redirect', `Refusing insecure URL scheme ${current.protocol}`)
    }
    if (allowHost && !allowHost(current.hostname)) throw new FetchError('blocked-host', 'Host not allowed')

    let res: Response
    try {
      res = await fetch(current, { redirect: 'manual', signal: abort, headers: accept ? { Accept: accept } : {} })
    } catch (err) {
      throw new FetchError('network', err instanceof Error ? err.message : 'Network error')
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel()
      const location = res.headers.get('location')
      if (!location) throw new FetchError('status', 'Redirect without a Location header', res.status)
      if (/^magnet:\?/i.test(location)) return { kind: 'magnet', uri: location }
      current = new URL(location, current)
      continue
    }

    if (!res.ok || !res.body) {
      await res.body?.cancel()
      throw new FetchError('status', `HTTP ${res.status}`, res.status)
    }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
      await res.body.cancel()
      throw new FetchError('too-large', 'Response too large')
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > maxBytes) throw new FetchError('too-large', 'Response too large')
        chunks.push(value)
      }
    } catch (err) {
      await reader.cancel().catch(() => {})
      if (err instanceof FetchError) throw err
      throw new FetchError('network', err instanceof Error ? err.message : 'Network error')
    }
    return { kind: 'body', body: Buffer.concat(chunks) }
  }
  throw new FetchError('too-many-redirects', 'Too many redirects')
}

export async function fetchCapped(url: string | URL, options: CappedFetchOptions): Promise<Uint8Array> {
  const result = await fetchBodyOrMagnet(url, options)
  if (result.kind === 'magnet') throw new FetchError('unexpected-magnet', 'Redirected to a magnet link')
  return result.body
}

export async function fetchText(url: string | URL, options: CappedFetchOptions): Promise<string> {
  return new TextDecoder().decode(await fetchCapped(url, options))
}

export async function fetchJson(url: string | URL, options: CappedFetchOptions): Promise<unknown> {
  const text = await fetchText(url, { accept: 'application/json', ...options })
  try {
    return JSON.parse(text)
  } catch {
    throw new FetchError('invalid-json', 'Response was not valid JSON')
  }
}
