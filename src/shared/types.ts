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
}

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

/** A configured source as the UI sees it. Secrets (API keys) never leave the main process. */
export interface ProviderSettingsView {
  id: string
  type: 'archive' | 'torznab'
  name: string
  enabled: boolean
  builtIn: boolean
  url?: string
  hasApiKey?: boolean
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
  onStats(listener: (stats: TorrentStats[]) => void): () => void
}
