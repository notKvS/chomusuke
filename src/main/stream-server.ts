import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { pipeline, Readable } from 'node:stream'
import { logger } from './log.ts'
import { parseRange } from './range.ts'

const log = logger('stream')

export interface StreamableFile {
  length: number
  mime: string
  /** `end` is inclusive */
  createReadStream(start: number, end: number): Readable
}

/** Finds the file behind a media URL. May take a moment (an http source asks its server for the file's length). */
export type FileResolver = (
  infoHash: string,
  fileIndex: number
) => StreamableFile | undefined | Promise<StreamableFile | undefined>

export const FILE_UNAVAILABLE = 502

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

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'no-store')
    // Lets the player window read an album cover's pixels (to tint the lyrics panel from it). Nothing is exposed that
    // wasn't: every URL here needs the per-launch token, and the Host check above stops DNS rebinding.
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (req.headers.host !== expectedHost) {
      log.warn(`refused a request for host ${req.headers.host}`)
      return sendStatus(res, 403)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, { Allow: 'GET, HEAD' })

    const match = ROUTE.exec(req.url ?? '')
    if (!match || !timingSafeEqual(Buffer.from(match[1]), tokenBytes)) return sendStatus(res, 404)

    const what = `${match[2]}/${match[3]}`
    let file: StreamableFile | undefined
    try {
      file = await resolve(match[2], Number(match[3]))
    } catch (err) {
      log.warn(`${what}: couldn't open the file:`, err)
      return sendStatus(res, FILE_UNAVAILABLE)
    }
    if (!file) {
      log.debug(`${what}: not a playable file of an open album`)
      return sendStatus(res, 404)
    }

    const range = parseRange(req.headers.range, file.length)
    if (range === 'unsatisfiable') {
      log.debug(`${what}: range ${req.headers.range} is outside ${file.length} bytes`)
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
    log.debug(`${what}: ${req.method} bytes ${start}-${end} of ${file.length}`)
    if (req.method === 'HEAD' || length === 0) return res.end()

    let source: Readable
    try {
      source = file.createReadStream(start, end)
    } catch (err) {
      log.warn(`${what}: couldn't read the file:`, err)
      return res.destroy()
    }
    // Client aborts (seeking, skipping tracks) are routine; pipeline tears down the torrent stream.
    pipeline(Readable.from(take(source, length)), res, err => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE')
        log.warn(`${what}: stream failed:`, err)
      source.destroy()
    })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const { port } = server.address() as AddressInfo
  expectedHost = `127.0.0.1:${port}`
  log.info(`listening on ${expectedHost}`)

  return {
    baseUrl: `http://${expectedHost}/media/${token}`,
    close: () =>
      new Promise(resolveClose => {
        server.closeAllConnections()
        server.close(() => resolveClose())
      })
  }
}
