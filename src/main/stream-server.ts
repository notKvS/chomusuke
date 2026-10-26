import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { pipeline, Readable } from 'node:stream'
import { parseRange } from './range.ts'

export interface StreamableFile {
  length: number
  mime: string
  /** `end` is inclusive */
  createReadStream(start: number, end: number): Readable
}

export type FileResolver = (infoHash: string, fileIndex: number) => StreamableFile | undefined

export interface StreamServer {
  /** e.g. http://127.0.0.1:51234/media/<token> — append `/<infoHash>/<fileIndex>` */
  baseUrl: string
  close(): Promise<void>
}

const ROUTE = /^\/media\/([a-f0-9]{64})\/([a-f0-9]{40})\/(\d{1,6})$/

/** Caps a stream at `limit` bytes; guards against sources that ignore the requested end offset. */
async function* take(source: AsyncIterable<Uint8Array>, limit: number): AsyncGenerator<Uint8Array> {
  let remaining = limit
  for await (const chunk of source) {
    if (chunk.length >= remaining) {
      yield chunk.subarray(0, remaining)
      return
    }
    remaining -= chunk.length
    yield chunk
  }
}

function sendStatus(res: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'Content-Length': 0, ...headers })
  res.end()
}

/**
 * Loopback-only HTTP server that streams torrent files to the renderer's <audio> element
 * with Range support. Every URL carries a per-launch random token so other local processes
 * and web pages (via DNS rebinding) cannot read from it.
 */
export async function startStreamServer(resolve: FileResolver): Promise<StreamServer> {
  const token = randomBytes(32).toString('hex')
  const tokenBytes = Buffer.from(token)
  let expectedHost = ''

  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'no-store')

    if (req.headers.host !== expectedHost) return sendStatus(res, 403)
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, { Allow: 'GET, HEAD' })

    const match = ROUTE.exec(req.url ?? '')
    if (!match || !timingSafeEqual(Buffer.from(match[1]), tokenBytes)) return sendStatus(res, 404)

    const file = resolve(match[2], Number(match[3]))
    if (!file) return sendStatus(res, 404)

    const range = parseRange(req.headers.range, file.length)
    if (range === 'unsatisfiable') {
      return sendStatus(res, 416, { 'Content-Range': `bytes */${file.length}` })
    }

    const start = range?.start ?? 0
    const end = range?.end ?? file.length - 1
    const length = file.length === 0 ? 0 : end - start + 1
    res.writeHead(range ? 206 : 200, {
      'Content-Type': file.mime,
      'Content-Length': length,
      'Accept-Ranges': 'bytes',
      ...(range && { 'Content-Range': `bytes ${start}-${end}/${file.length}` })
    })
    if (req.method === 'HEAD' || length === 0) return res.end()

    let source: Readable
    try {
      source = file.createReadStream(start, end)
    } catch {
      return res.destroy()
    }
    // Client aborts (seeking, skipping tracks) are routine; pipeline tears down the torrent stream.
    pipeline(Readable.from(take(source, length)), res, () => source.destroy())
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const { port } = server.address() as AddressInfo
  expectedHost = `127.0.0.1:${port}`

  return {
    baseUrl: `http://${expectedHost}/media/${token}`,
    close: () =>
      new Promise(resolveClose => {
        server.closeAllConnections()
        server.close(() => resolveClose())
      })
  }
}
