import { ipcMain } from 'electron'
import parseTorrent from 'parse-torrent'
import type { Album, LibraryResponse, LibraryView } from '../../shared/types.ts'
import type { TorrentEngine } from '../engine.ts'
import { isInfoHash, type LibraryEntry, LibraryError, type SeedLibrary } from '../seeding.ts'
import { SourceError } from '../source.ts'
import type { IpcDeps } from './deps.ts'
import { toResult } from './guard.ts'

/** Applies the saved sharing settings to the torrent client. */
export function applySharing(library: SeedLibrary, torrents: TorrentEngine): void {
  const { enabled, uploadLimitKBps } = library.sharing
  torrents.setSharing(enabled, uploadLimitKBps * 1024)
}

/** Opens a kept album from the library folder (verifying what's already on disk) and fetches the rest. */
async function loadFromLibrary(library: SeedLibrary, torrents: TorrentEngine, infoHash: string): Promise<Album> {
  // Kept albums download in full; streamed ones only seed what they have (and fetch what's played).
  const kept = library.has(infoHash)
  const loaded = torrents.album(infoHash)
  if (loaded) {
    if (kept) torrents.keep(infoHash)
    return loaded
  }
  const entry = library.get(infoHash)
  if (!entry) throw new SourceError('That album isn’t in your library any more.')
  const data = await library.readTorrent(infoHash).catch(() => {
    throw new SourceError('This album’s torrent file is missing from your library.')
  })
  const parsed = await parseTorrent(data).catch(() => undefined)
  if (parsed?.infoHash !== infoHash) throw new SourceError('This album’s torrent file is damaged.')
  const album = await torrents.load(data, { title: entry.title, artist: entry.artist }, library.dataPath(infoHash))
  if (kept) torrents.keep(infoHash)
  return album
}

/** Starts seeding the library in the background (when the user hasn't opted out). */
export async function seedLibrary(library: SeedLibrary, torrents: TorrentEngine): Promise<void> {
  const { enabled, seedLibrary: kept, seedStreamed: streamed } = library.sharing
  if (!enabled) return
  const entries = [...(kept ? library.list() : []), ...(streamed ? library.listStreamed() : [])]
  for (const entry of entries) {
    await loadFromLibrary(library, torrents, entry.infoHash).catch(err =>
      console.error(`[library] couldn't seed ${entry.infoHash}:`, err instanceof Error ? err.message : err)
    )
  }
}

function libraryView(library: SeedLibrary, torrents: TorrentEngine): LibraryView {
  const withActivity = (entry: LibraryEntry, progress: boolean) => {
    const activity = torrents.activity(entry.infoHash)
    return {
      ...entry,
      active: activity !== undefined,
      progress: progress ? activity?.progress : undefined,
      uploaded: activity?.uploaded ?? 0,
      numPeers: activity?.numPeers ?? 0,
      uploadSpeed: activity?.uploadSpeed ?? 0
    }
  }
  const streamed = library.listStreamed()
  return {
    sharing: library.sharing,
    items: library.list().map(entry => withActivity(entry, true)),
    streamed: streamed.map(entry => withActivity(entry, false)),
    streamedBytes: streamed.reduce((sum, entry) => sum + entry.size, 0),
    session: torrents.totals()
  }
}

async function toLibraryResponse(
  library: SeedLibrary,
  torrents: TorrentEngine,
  work: () => Promise<unknown>
): Promise<LibraryResponse> {
  try {
    await work()
    return { ok: true, library: libraryView(library, torrents) }
  } catch (err) {
    if (err instanceof LibraryError) return { ok: false, error: err.message }
    console.error('[library]', err)
    return { ok: false, error: 'Something went wrong with your library.' }
  }
}

/** Saved albums, what was streamed, and the sharing (seeding) settings. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, torrents, library } = deps
  ipcMain.handle('library:get', (event): LibraryView => {
    assertTrustedSender(event)
    return libraryView(library, torrents)
  })

  ipcMain.handle('library:keep', (event, infoHash: unknown, info: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(library, torrents, async () => {
      const kept = isInfoHash(infoHash) ? torrents.keep(infoHash) : undefined
      if (!kept) throw new LibraryError('That album isn’t loaded any more.')
      const details = typeof info === 'object' && info !== null ? (info as Record<string, unknown>) : {}
      await library.add(
        { title: details.title, artist: details.artist, coverUrl: details.coverUrl, infoHash, size: kept.size },
        kept.torrentFile
      )
    })
  })

  ipcMain.handle('library:remove', (event, infoHash: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(library, torrents, async () => {
      if (!isInfoHash(infoHash)) throw new LibraryError('That album isn’t in your library.')
      await library.remove(infoHash)
    })
  })

  ipcMain.handle('library:clear-streamed', event => {
    assertTrustedSender(event)
    return toLibraryResponse(library, torrents, () => library.clearStreamed())
  })

  ipcMain.handle('library:open', (event, infoHash: unknown) => {
    assertTrustedSender(event)
    return toResult(library, async () => {
      if (!isInfoHash(infoHash)) throw new SourceError('That album isn’t in your library.')
      return loadFromLibrary(library, torrents, infoHash)
    })
  })

  ipcMain.handle('sharing:set', (event, raw: unknown) => {
    assertTrustedSender(event)
    return toLibraryResponse(library, torrents, async () => {
      const before = library.sharing
      await library.setSharing(raw)
      applySharing(library, torrents)
      const after = library.sharing
      // Turning seeding on starts it now rather than at the next launch.
      const seeds = (s: typeof after) => [s.enabled && s.seedLibrary, s.enabled && s.seedStreamed]
      const [keptNow, streamedNow] = seeds(after)
      const [keptBefore, streamedBefore] = seeds(before)
      if ((keptNow && !keptBefore) || (streamedNow && !streamedBefore)) void seedLibrary(library, torrents)
    })
  })
}
