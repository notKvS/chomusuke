import { sanitizeNowPlaying } from '../discord.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

/** What's playing, for the Discord status. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, presence } = deps
  handle('presence:set', (event, raw: unknown) => {
    assertTrustedSender(event)
    presence.update(sanitizeNowPlaying(raw))
  })
  handle('presence:status', event => {
    assertTrustedSender(event)
    return presence.current()
  })
}
