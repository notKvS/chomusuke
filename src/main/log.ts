// App-wide log: the main process, the player window and the plugin sandboxes all write here. Lines go to a file in
// the user-data folder (logs/main.log, about 1 MB, with the one before kept as main.old.log) and to the terminal.
// Secrets are scrubbed from every line before it's written; see scrub().
import log from 'electron-log/main'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_ARGS_LENGTH = 500

/** Under `node --test` there's no Electron: nothing is written to disk and only problems are printed. */
const inElectron = Boolean(process.versions.electron)

log.transports.file.level = inElectron ? 'debug' : false
log.transports.file.maxSize = MAX_FILE_BYTES
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'
log.transports.console.level = inElectron ? 'debug' : 'warn'
log.hooks.push(message => ({ ...message, data: message.data.map(scrubValue) }))

if (inElectron) {
  // Crashes and unhandled rejections in the main process, and Electron's own trouble events (a renderer or GPU
  // process gone, a page that failed to load, a window that stopped responding).
  log.errorHandler.startCatching({ showDialog: false })
  log.eventLogger.startLogging()
}

/** A logger whose lines are tagged with `scope`, e.g. `[torrent]`. */
export const logger = (scope: string) => log.scope(scope)

/** The folder the log files are in. */
export const logDir = (): string => {
  const file = log.transports.file.getFile().path
  return file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')))
}

const SECRETS: Array<[RegExp, string]> = [
  // The stream server's per-launch token is in every track and cover URL.
  [/(\/media\/)[a-f0-9]{64}/gi, '$1<token>'],
  // Indexer API keys, private-tracker passkeys and the like in URLs.
  [
    /([?&](?:api_?key|apikey|passkey|password|pass|token|access_token|auth|secret|sig|signature)=)[^&#\s"']+/gi,
    '$1<hidden>'
  ]
]

/** Removes secrets from a line of log text. */
export function scrub(text: string): string {
  return SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrub(value)
  if (value instanceof Error) return scrub(value.stack ?? `${value.name}: ${value.message}`)
  return value
}

const SECRET_FIELD = /^(api_?key|password|pass|passkey|secret|token|cookie|authorization|auth)$/i

/** IPC arguments as one short line: JSON, with secret-looking fields hidden and long values cut. */
export function describeArgs(args: unknown[]): string {
  const text = args
    .map(arg => {
      try {
        return JSON.stringify(arg, (key, value) => (SECRET_FIELD.test(key) ? '<hidden>' : value)) ?? String(arg)
      } catch {
        return String(arg)
      }
    })
    .join(', ')
  return text.length > MAX_ARGS_LENGTH ? `${text.slice(0, MAX_ARGS_LENGTH)}…` : text
}

/** The message of an IPC answer that reports a failure (`{ ok: false, error }`), if it is one. */
export function failureOf(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const { ok, error } = result as { ok?: unknown; error?: unknown }
  return ok === false && typeof error === 'string' ? error : undefined
}

/**
 * The text of an exported log: a header for whoever reads it, then the older log file and the current one.
 * Scrubbed again here, so a line that was written before a secret pattern was known doesn't leave the computer.
 */
export function buildLogExport(header: string[], files: string[]): string {
  return [...header, '', ...files.filter(Boolean).map(scrub)].join('\n')
}
