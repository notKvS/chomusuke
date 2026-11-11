/** What went wrong, for the crash dialog. */
export type CrashKind =
  /** The main process hit an error nothing handled */
  | 'main-error'
  /** The player window's page died (crashed, ran out of memory, was killed) */
  | 'window-gone'
  /** The player window's React tree broke and couldn't draw itself */
  | 'window-error'

/** `render-process-gone` also fires for a window that simply closed ("clean-exit"): that isn't a crash. */
export const isCrash = (reason: string): boolean => reason !== 'clean-exit'

const WHAT: Record<CrashKind, string> = {
  'main-error': 'The app hit an unexpected error.',
  'window-gone': 'The app’s window stopped working.',
  'window-error': 'The app’s window ran into an error it couldn’t recover from.'
}

/** The dialog's second paragraph: what happened, and what sharing the log does. */
export const crashDetail = (kind: CrashKind): string =>
  `${WHAT[kind]}\n\nSending the developer the log helps fix it. It shows what the app was doing, never passwords or API keys. “Share with developer” saves the log as a file you can send on, then restarts the app.`
