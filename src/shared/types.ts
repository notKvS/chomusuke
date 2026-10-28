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
  /** Upper-case container/codec hint taken from the extension, e.g. MP3, FLAC */
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
export interface RatedSong {
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
  rating: 1 | -1
  ratedAt: string
}

export type BackupExportResult =
  | { ok: true; path: string; songs: number; albums: number }
  | { ok: false; error: string }
  | null

export type BackupImportResult =
  | { ok: true; songs: number; albums: number; appearance?: unknown }
  | { ok: false; error: string }
  | null

/** Optional display info for curated sources (the torrent itself carries no artist metadata). */
export interface SourceHints {
  title?: string
  artist?: string
}

export type LoadResult = { ok: true; album: Album } | { ok: false; error: string }

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

export interface ExploreSource {
  id: string
  name: string
  layout: 'cards' | 'list'
  categories: SourceCategory[]
}

export type BrowseResponse = { ok: true; section: ProviderSection } | { ok: false; error: string }

/** A user-configurable extension option. Secret values never leave the main process. */
export interface ExtensionOptionView {
  key: string
  type: 'string' | 'boolean'
  label: string
  description?: string
  secret: boolean
  /** Current value (omitted for secrets) */
  value?: string | boolean
  /** For secrets: whether a value is saved */
  hasValue?: boolean
}

/** A configured source as the UI sees it. Secrets (API keys) never leave the main process. */
export interface ProviderSettingsView {
  id: string
  type: 'archive' | 'torznab' | 'extension'
  name: string
  enabled: boolean
  builtIn: boolean
  url?: string
  hasApiKey?: boolean
  /** Extensions only */
  version?: string
  description?: string
  hosts?: string[]
  options?: ExtensionOptionView[]
}

export interface TorznabForm {
  /** Present when editing an existing indexer */
  id?: string
  name: string
  url: string
  /** Empty when editing means "keep the saved key" */
  apiKey: string
}

export type ProvidersResponse = { ok: true; providers: ProviderSettingsView[] } | { ok: false; error: string }
export type TestResponse = { ok: true; message: string } | { ok: false; error: string }

export interface ChomusukeApi {
  loadSource(source: string, hints?: SourceHints): Promise<LoadResult>
  openTorrentFile(): Promise<LoadResult | null>
  search(query: string): Promise<SearchResponse>
  openResult(albumId: string): Promise<LoadResult>
  listProviders(): Promise<ProvidersResponse>
  saveTorznab(form: TorznabForm): Promise<ProvidersResponse>
  testTorznab(form: TorznabForm): Promise<TestResponse>
  setProviderEnabled(id: string, enabled: boolean): Promise<ProvidersResponse>
  removeProvider(id: string): Promise<ProvidersResponse>
  importExtensions(repositoryUrl: string): Promise<ProvidersResponse>
  setExtensionOptions(id: string, values: Record<string, string | boolean>): Promise<ProvidersResponse>
  testExtension(id: string): Promise<TestResponse>
  exploreSources(): Promise<ExploreSource[]>
  browse(sourceId: string, categoryId: string): Promise<BrowseResponse>
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
  getRatings(): Promise<RatedSong[]>
  /** Like (1), dislike (-1) or clear (0) a track of a loaded album. Returns the updated list. */
  rateTrack(infoHash: string, key: string, rating: 0 | 1 | -1): Promise<RatedSong[]>
  /** Saves a backup file (ratings, kept albums and the given appearance settings); null when cancelled. */
  exportBackup(appearance: unknown): Promise<BackupExportResult>
  /** Reads a backup file and merges it in; kept albums are re-downloaded in the background. */
  importBackup(): Promise<BackupImportResult>
}

export interface WindowAppearance {
  /** 0.8–1.3 */
  zoom: number
  /** #rrggbb */
  titleBarColor: string
  titleBarSymbolColor: string
}
