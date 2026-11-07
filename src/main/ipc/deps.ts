import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { DiscordPresence } from '../discord.ts'
import type { TorrentEngine } from '../engine.ts'
import type { ArtistGenres } from '../genres.ts'
import type { PlayHistory } from '../history.ts'
import type { PlaylistStore } from '../playlists.ts'
import type { PluginHost } from '../plugin-host/host.ts'
import type { PluginManifest } from '../plugin-host/manifest.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import type { ProviderSettingsStore } from '../providers/settings.ts'
import type { RatingsStore } from '../ratings.ts'
import type { SeedLibrary } from '../seeding.ts'
import type { Updater } from '../updater.ts'

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
  /** What was played lately. */
  history: PlayHistory
  /** The kinds of music an artist makes. */
  artistGenres: ArtistGenres
  /** The Discord status; follows the `discordStatus` sharing setting. */
  presence: DiscordPresence
  /** The sandbox for an installed plugin, reused while its code is unchanged. */
  pluginRuntime: (manifest: PluginManifest, code: string, codeSha256: string) => PluginHost
  /** Tears down the sandboxes of plugins that are no longer enabled. */
  disposeUnusedHosts: (activeIds: Set<string>) => void
  /** Updates from GitHub releases. */
  updater: Updater
}
