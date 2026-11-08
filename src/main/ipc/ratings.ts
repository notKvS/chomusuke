import type { RatedSong } from '../../shared/types.ts'
import { isInfoHash } from '../seeding.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

/** Liked and disliked songs. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, ratings } = deps
  handle('ratings:list', (event): RatedSong[] => {
    assertTrustedSender(event)
    return ratings.list()
  })

  handle('ratings:set', async (event, infoHash: unknown, key: unknown, rating: unknown): Promise<RatedSong[]> => {
    assertTrustedSender(event)
    if (!isInfoHash(infoHash) || typeof key !== 'string' || (rating !== 0 && rating !== 1 && rating !== -1)) {
      return ratings.list()
    }
    if (rating === 0) await ratings.set({ infoHash, key }, 0)
    else {
      // Song details come from the loaded torrent, not from the UI.
      const info = torrents.songInfo(infoHash, key)
      if (info) await ratings.set(info, rating)
    }
    return ratings.list()
  })
}
