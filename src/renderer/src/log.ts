// The player window's side of the app log (src/main/log.ts): lines are sent to the main process, which writes them
// to the log file tagged [renderer]. Everything still prints in DevTools as usual.

type Level = 'error' | 'warn' | 'info' | 'debug'

function text(args: unknown[]): string {
  return args
    .map(arg => {
      if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg) ?? String(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function send(level: Level, args: unknown[]): void {
  try {
    window.chomusuke.log(level, text(args))
  } catch {
    // Logging must never break the page.
  }
}

export const log = {
  error: (...args: unknown[]) => send('error', args),
  warn: (...args: unknown[]) => send('warn', args),
  info: (...args: unknown[]) => send('info', args),
  debug: (...args: unknown[]) => send('debug', args)
}

/** Sends uncaught errors, unhandled rejections and console.error/warn (React's warnings among them) to the log. */
export function captureErrors(): void {
  window.addEventListener('error', event =>
    send('error', [`uncaught: ${event.message} (${event.filename}:${event.lineno})`, event.error])
  )
  window.addEventListener('unhandledrejection', event => send('error', ['unhandled rejection:', event.reason]))
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      send(level, args)
    }
  }
}
