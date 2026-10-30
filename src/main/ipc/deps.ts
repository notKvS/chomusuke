import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { TorrentEngine } from '../engine.ts'
import type { ExtensionHost } from '../extension-host/host.ts'
import type { ExtensionManifest } from '../extension-host/manifest.ts'
import type { PlaylistStore } from '../playlists.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import type { ProviderSettingsStore } from '../providers/settings.ts'
import type { RatingsStore } from '../ratings.ts'
import type { SeedLibrary } from '../seeding.ts'

/**
 * What the IPC handlers work with, passed to each area's `register`. Every handler must call
 * `assertTrustedSender(event)` before it does anything else.
 */
export interface IpcDeps {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void
  /** The player window: null before it opens and after it closes, so read it when a handler runs. */
  mainWindow: () => BrowserWindow | null
  torrents: TorrentEngine
  registry: ProviderRegistry
  settings: ProviderSettingsStore
  library: SeedLibrary
  ratings: RatingsStore
  playlists: PlaylistStore
  /** The sandbox for an installed extension, reused while its code is unchanged. */
  extensionRuntime: (manifest: ExtensionManifest, code: string, codeSha256: string) => ExtensionHost
  /** Tears down the sandboxes of extensions that are no longer enabled. */
  disposeUnusedHosts: (activeIds: Set<string>) => void
}
