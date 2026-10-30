// Checks shared by every IPC handler: who may call, and cleaning up what the renderer sends.
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { Album, LoadResult, SourceHints } from '../../shared/types.ts'
import type { SeedLibrary } from '../seeding.ts'
import { SourceError } from '../source.ts'

const MAX_HINT_LENGTH = 200
export const MAX_QUERY_LENGTH = 200
export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * IPC is only accepted from our own top-level frame. Returns the check for `IpcDeps.assertTrustedSender`; it throws
 * (rejecting the renderer's promise) for anything else, including calls before the window exists.
 */
export function trustedSenderGuard(mainWindow: () => BrowserWindow | null): (event: IpcMainInvokeEvent) => void {
  return function assertTrustedSender(event) {
    const window = mainWindow()
    if (!window || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Rejected IPC from untrusted sender')
    }
  }
}

/** Title/artist hints from the renderer: trimmed, length-limited strings or nothing. */
export function sanitizeHints(raw: unknown): SourceHints {
  if (!raw || typeof raw !== 'object') return {}
  const pick = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_HINT_LENGTH) : undefined
  const { title, artist } = raw as Record<string, unknown>
  return { title: pick(title), artist: pick(artist) }
}

/** Runs an album load for the renderer, turning failures into a message it can show. */
export async function toResult(library: SeedLibrary, work: () => Promise<Album>): Promise<LoadResult> {
  try {
    const album = await work()
    // Every user-opened album counts as played: streamed albums played recently are evicted last.
    void library.touch(album.infoHash).catch(() => {})
    return { ok: true, album }
  } catch (err) {
    if (err instanceof SourceError) return { ok: false, error: err.message }
    console.error('[ipc] unexpected load failure:', err)
    return { ok: false, error: 'Something went wrong while loading this torrent.' }
  }
}

/** A file name that's safe on every OS, from a torrent's (untrusted) name. */
export function safeFileName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) || !clean ? 'album' : clean
}
