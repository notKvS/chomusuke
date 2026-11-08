export interface Track {
  /** Stable id: `${infoHash}:${fileIndex}` */
  id: string
  /** Song key inside the torrent (relative path without extension); matches SearchSong.key */
  key: string
  fileIndex: number
  title: string
  artist?: string
  trackNo?: number
  /** Seconds, when known from metadata before playback */
  duration?: number
  /** Upper-case container/codec hint taken from the file extension, e.g. MP3, FLAC */
  format: string
  size: number
  /** Loopback streaming URL for an <audio> element */
  url: string
}

export interface Album {
  infoHash: string
  title: string
  artist?: string
  coverUrl?: string
  tracks: Track[]
  totalSize: number
}

export interface TorrentStats {
  infoHash: string
  numPeers: number
  downloadSpeed: number
  uploadSpeed: number
  /** Bytes sent to other peers this session */
  uploaded: number
}

/** Everything about one loaded torrent, for the album page's "Torrent" panel. */
export interface TorrentDetails {
  infoHash: string
  name: string
  magnetURI: string
  /** Total size of every file in the torrent, bytes */
  size: number
  pieceLength: number
  pieceCount: number
  /** First files of the torrent (capped), with download progress 0–1 */
  files: Array<{ path: string; size: number; progress: number; playable: boolean }>
  fileCount: number
  trackers: string[]
  numPeers: number
  downloadSpeed: number
  uploadSpeed: number
  downloaded: number
  uploaded: number
  createdBy?: string
  comment?: string
  /** ISO date */
  created?: string
  /** In the user's library (kept on disk and seeded) */
  kept: boolean
}

/** Opt-out sharing: whether this app uploads to other listeners, and how. */
export interface SharingSettings {
  /** Upload pieces you have to other peers (seeding). */
  enabled: boolean
  /** Seed library albums in the background whenever the app is open. */
  seedLibrary: boolean
  /** Keep what you stream on disk after quitting and seed it next time (off: cleared on quit). */
  seedStreamed: boolean
  /** Disk space for streamed music, GB; least recently played albums are dropped first. */
  streamCacheGB: number
  /** KB/s, 0 = unlimited */
  uploadLimitKBps: number
  /** Show what's playing as your Discord status. */
  discordStatus: boolean
  /** Let the DevTools shortcuts work in the installed app (always on when running from source). */
  developerTools: boolean
}

/** A song that was played, as remembered for Home's suggestions. */
export interface PlayedSong {
  title: string
  artist?: string
  album?: string
}

/** A row on Home, and where its albums come from. */
export interface HomeShelf {
  id: string
  title: string
  subtitle?: string
  source: { kind: 'search'; query: string } | { kind: 'chart'; sourceId: string; categoryId: string }
}

/** Whether the Discord status is getting through, for the Settings page. */
export type DiscordStatus =
  | { kind: 'off' }
  /** Turned on, nothing sent yet (nothing has played, or Discord hasn't been needed). */
  | { kind: 'idle' }
  /** The Discord desktop app can't be reached: it isn't running, or only its web version is. */
  | { kind: 'not-running' }
  | { kind: 'connected' }
  /** Discord answered with an error. */
  | { kind: 'refused'; message: string }

/** What's playing, for the Discord status. */
export interface NowPlaying {
  title: string
  artist?: string
  album?: string
  /** Only remote https covers; Discord can't load ones from the local stream server. */
  coverUrl?: string
  playing: boolean
  /** Seconds into the track */
  position: number
  /** Seconds, 0 while unknown */
  duration: number
}

export interface LibraryItem {
  infoHash: string
  title: string
  artist?: string
  coverUrl?: string
  /** Bytes of the album's audio */
  size: number
  addedAt: string
  /** Loaded in the torrent client right now (downloading and/or seeding) */
  active: boolean
  /** Share of the album's audio that's on disk, 0–1 (only known while active) */
  progress?: number
  uploaded: number
  numPeers: number
  uploadSpeed: number
}

export interface LibraryView {
  sharing: SharingSettings
  /** Kept albums */
  items: LibraryItem[]
  /** Albums streamed in earlier sessions, still on disk and seeded; `addedAt` is when last played */
  streamed: LibraryItem[]
  /** Disk used by streamed albums (as of the last quit) */
  streamedBytes: number
  /** This session, across every torrent */
  session: { uploaded: number; uploadSpeed: number }
}

export type LibraryResponse = { ok: true; library: LibraryView } | { ok: false; error: string }

export type SaveTorrentResult = { ok: true; path: string } | { ok: false; error: string } | null

/** A liked (1) or disliked (-1) song. Identified by its torrent and file, so it's the same from every source. */
/** A song that can be found and played again later: identified by its torrent and file, so it's the same from every source. */
export interface SongRef {
  /** `${infoHash}:${key}` */
  id: string
  infoHash: string
  /** Track key inside the torrent (matches Track.key) */
  key: string
  title: string
  artist?: string
  album?: string
  duration?: number
  /** Normalised artist|title, to recognise the same song in other torrents */
  fingerprint?: string
  /** To play it again: the torrent's magnet link with public trackers and web seeds */
  magnet: string
}

/** A liked (1) or disliked (-1) song. */
export interface RatedSong extends SongRef {
  rating: 1 | -1
  ratedAt: string
}

export interface PlaylistSong extends SongRef {
  addedAt: string
}

export interface Playlist {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  songs: PlaylistSong[]
}

export type BackupExportResult =
  | { ok: true; path: string; songs: number; albums: number; playlists: number }
  | { ok: false; error: string }
  | null

export type BackupImportResult =
  | { ok: true; songs: number; albums: number; playlists: number; appearance?: unknown }
  | { ok: false; error: string }
  | null

/** Optional display info for curated sources (the torrent itself carries no artist metadata). */
export interface SourceHints {
  title?: string
  artist?: string
}

export type LoadResult = { ok: true; album: Album; startKey?: string } | { ok: false; error: string }

/** One album/release found by a provider. `id` is opaque: pass it back to openResult(). */
export interface SearchAlbum {
  id: string
  /** Provider id, e.g. "archive" */
  provider: string
  title: string
  artist?: string
  year?: string
  license?: string
  artwork?: string
  seeders?: number
  peers?: number
  size?: number
  tags?: string[]
  /**
   * Chart entries (top albums/songs) have no torrent of their own: opening one searches the providers for
   * it, and for a song the load result says which track it is (`startKey`).
   */
  chart?: 'album' | 'song'
}

export interface SearchSong {
  id: string
  /** Song key inside the album's torrent; matches Track.key */
  key: string
  title: string
  artist?: string
  duration?: number
  album: SearchAlbum
}

/** Results from one provider, shown as its own shelf. */
export interface ProviderSection {
  id: string
  name: string
  layout: 'cards' | 'list'
  albums: SearchAlbum[]
  /** Set when this provider failed; other providers' results are still shown. */
  error?: string
  /** The provider has another page of results (ask with searchMore / browse with the next page number). */
  hasMore?: boolean
}

export interface SearchResults {
  query: string
  songs: SearchSong[]
  sections: ProviderSection[]
}

export type SearchResponse = { ok: true; results: SearchResults } | { ok: false; error: string }

/** A category a source can be browsed by (Explore page), e.g. "Trending this week" or "Lossless". */
export interface SourceCategory {
  id: string
  name: string
}

/** A chart on the Explore page (top albums/songs), browsed by category. */
export interface ExploreSource {
  id: string
  name: string
  categories: SourceCategory[]
  /** Set when the chart can be asked for another country. */
  region?: ChartRegion
}

/** How a chart takes a country. */
export interface ChartRegion {
  /** The country the user saved for this chart in Settings ("" = worldwide). */
  current: string
  /** Whether the chart has a worldwide list (asked for with ""). */
  worldwide: boolean
  /** The categories that follow the country; all of them when left out. */
  categories?: string[]
}

/** The Explore page: the enabled charts, and whether any provider is on to play their entries. */
export interface ExploreOverview {
  charts: ExploreSource[]
  canPlay: boolean
}

export type BrowseResponse = { ok: true; section: ProviderSection } | { ok: false; error: string }

/** A user-configurable plugin option. Secret values never leave the main process. */
export interface PluginOptionView {
  key: string
  type: 'string' | 'boolean'
  label: string
  description?: string
  secret: boolean
  /** The plugin does nothing until this is filled in. */
  required?: boolean
  /** Grey hint inside the empty field */
  placeholder?: string
  /** Current value (omitted for secrets) */
  value?: string | boolean
  /** For secrets: whether a value is saved */
  hasValue?: boolean
}

/** A configured source as the UI sees it. Secrets (API keys) never leave the main process. */
export interface ProviderSettingsView {
  id: string
  type: 'archive' | 'torznab' | 'plugin'
  name: string
  enabled: boolean
  builtIn: boolean
  url?: string
  hasApiKey?: boolean
  /** Plugins only */
  version?: string
  description?: string
  hosts?: string[]
  options?: PluginOptionView[]
  /** What the plugin needs the options for, for the setup window. */
  setup?: string
  /** A required option has no value yet. */
  needsSetup?: boolean
  /** Chart plugins list top albums/songs and play them through the providers */
  chart?: boolean
}

export interface TorznabForm {
  /** Present when editing an existing indexer */
  id?: string
  name: string
  url: string
  /** Empty when editing means "keep the saved key" */
  apiKey: string
}

/** What a plugin does: finds and plays music (a provider), or lists what's popular (a chart). */
export type PluginKind = 'provider' | 'chart'

export type ProvidersResponse = { ok: true; providers: ProviderSettingsView[] } | { ok: false; error: string }
export type TestResponse = { ok: true; message: string } | { ok: false; error: string }

/** Where the app is with updating itself. */
export type UpdateStatus =
  /** Running from source: never checks. */
  | { state: 'off' }
  /** Not checked yet. */
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded: restarting installs it (so does quitting). */
  | { state: 'ready'; version: string }
  /** This copy can't install it itself (macOS, Windows zip, .deb): download it from its release page. */
  | { state: 'available'; version: string }
  | { state: 'error'; message: string }

export interface UpdateState {
  currentVersion: string
  status: UpdateStatus
}

export interface ChomusukeApi {
  loadSource(source: string, hints?: SourceHints): Promise<LoadResult>
  openTorrentFile(): Promise<LoadResult | null>
  search(query: string): Promise<SearchResponse>
  /** The next page of one source's albums for a search (page 2, 3…), when its section said `hasMore`. */
  searchMore(sourceId: string, query: string, page: number): Promise<BrowseResponse>
  openResult(albumId: string): Promise<LoadResult>
  listProviders(): Promise<ProvidersResponse>
  saveTorznab(form: TorznabForm): Promise<ProvidersResponse>
  testTorznab(form: TorznabForm): Promise<TestResponse>
  setProviderEnabled(id: string, enabled: boolean): Promise<ProvidersResponse>
  removeProvider(id: string): Promise<ProvidersResponse>
  /** Installs the plugins of one kind from a repository; the other kind is left for its own tab. */
  importPlugins(repositoryUrl: string, kind: PluginKind): Promise<ProvidersResponse>
  setPluginOptions(id: string, values: Record<string, string | boolean>): Promise<ProvidersResponse>
  testPlugin(id: string): Promise<TestResponse>
  exploreSources(): Promise<ExploreOverview>
  /** One page (default 1) of a source's category. */
  /** One page of a chart category. `region` is a country code (or "" for worldwide) instead of the saved default. */
  browse(sourceId: string, categoryId: string, page?: number, region?: string): Promise<BrowseResponse>
  onStats(listener: (stats: TorrentStats[]) => void): () => void
  /** Window chrome that follows the theme: zoom factor and the native title-bar overlay colours. */
  setWindowAppearance(appearance: WindowAppearance): Promise<void>
  getTorrentDetails(infoHash: string): Promise<TorrentDetails | null>
  /** Shows a save dialog for the .torrent file; null when cancelled. */
  saveTorrentFile(infoHash: string): Promise<SaveTorrentResult>
  copyMagnet(infoHash: string): Promise<boolean>
  getLibrary(): Promise<LibraryView>
  /** Keeps an album: downloads all of its audio to the library folder and seeds it (when sharing is on). */
  keepAlbum(infoHash: string, info: { title: string; artist?: string; coverUrl?: string }): Promise<LibraryResponse>
  /** Removes a kept or streamed album; its files are deleted when the app closes. */
  removeFromLibrary(infoHash: string): Promise<LibraryResponse>
  /** Forgets every streamed album; files are deleted when the app closes. */
  clearStreamed(): Promise<LibraryResponse>
  openLibraryAlbum(infoHash: string): Promise<LoadResult>
  setSharing(settings: SharingSettings): Promise<LibraryResponse>
  /** Tells the app what's playing (null: nothing), shown as the Discord status when that's turned on. */
  setNowPlaying(nowPlaying: NowPlaying | null): Promise<void>
  getDiscordStatus(): Promise<DiscordStatus>
  /** Remembers that a song was played (once it has been listened to for a while). */
  recordPlay(song: PlayedSong): Promise<void>
  /** How many plays are remembered. */
  getHistorySize(): Promise<number>
  clearHistory(): Promise<void>
  /** The rows Home shows for what you listen to; with nothing played yet, a popular chart. */
  getHomeShelves(): Promise<HomeShelf[]>
  getRatings(): Promise<RatedSong[]>
  /** Like (1), dislike (-1) or clear (0) a track of a loaded album. Returns the updated list. */
  rateTrack(infoHash: string, key: string, rating: 0 | 1 | -1): Promise<RatedSong[]>
  /** Saves a backup file (ratings, kept albums and the given appearance settings); null when cancelled. */
  exportBackup(appearance: unknown): Promise<BackupExportResult>
  /** Reads a backup file and merges it in; kept albums are re-downloaded in the background. */
  importBackup(): Promise<BackupImportResult>
  getPlaylists(): Promise<Playlist[]>
  createPlaylist(name: string): Promise<{ playlists: Playlist[]; id?: string; error?: string }>
  renamePlaylist(id: string, name: string): Promise<Playlist[]>
  deletePlaylist(id: string): Promise<Playlist[]>
  /** Adds a track of a loaded album (details come from the torrent, not the UI). */
  addToPlaylist(id: string, infoHash: string, key: string): Promise<Playlist[]>
  /** Adds songs that are already known (e.g. from another playlist or the liked list). */
  addSongsToPlaylist(id: string, songs: SongRef[]): Promise<Playlist[]>
  removeFromPlaylist(id: string, songId: string): Promise<Playlist[]>
  moveInPlaylist(id: string, from: number, to: number): Promise<Playlist[]>
  getUpdateState(): Promise<UpdateState>
  /** Checks GitHub for a newer release now. */
  checkForUpdates(): Promise<UpdateState>
  /** Quits (finishing up as usual) and installs the downloaded update, then reopens. */
  installUpdate(): Promise<void>
  /** Opens the new version's release page in the browser. */
  openUpdatePage(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Writes a line to the app's log file. */
  log(level: 'error' | 'warn' | 'info' | 'debug', message: string): void
  /** Opens the folder with the log files. */
  openLogs(): Promise<void>
}

export interface WindowAppearance {
  /** 0.8–1.3 */
  zoom: number
  /** #rrggbb */
  titleBarColor: string
  titleBarSymbolColor: string
}
