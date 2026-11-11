/**
 * Types for writing Chomusuke plugins. A plugin is a TypeScript module whose default export implements
 * `ProviderPlugin` (a provider: finds torrents), `StreamPlugin` (a provider with direct audio URLs) or `ChartPlugin`
 * (a public chart whose entries play through the providers).
 * `npm run build:plugins` bundles each one into a single ES module in `plugins/dist/`,
 * which the app loads into a sandboxed Web Worker (no DOM, no Node; fetch() only to the manifest's hosts).
 * Manifest format: see src/main/plugin-host/manifest.ts and plugins/index.json.
 */

/** One playable release. Needs `link` (magnet or https .torrent URL on a declared host) or `hash`. */
export interface TorrentResult {
  title: string
  link?: string
  hash?: string
  artist?: string
  year?: string
  size?: number
  seeders?: number
  leechers?: number
  /** https image URL */
  artwork?: string
  /** Up to 4 short labels (12 characters each), e.g. FLAC, CC BY; shown as chips on cards and release rows */
  tags?: string[]
}

export type Options = Record<string, string | boolean>

/**
 * What search/browse return: a plain list (the app won't ask for more), or one page plus `hasMore: true` to get a
 * "Load more" button. The next call then gets `page: 2`, and so on (up to page 20). At most 100 items per page.
 */
export type Paged<T> = T[] | { results: T[]; hasMore?: boolean }

export interface ProviderPlugin {
  /** Self-check for the Plugins page; return true or throw an Error with a user-facing message. */
  test?(context: { options: Options }): Promise<true>
  /** `page` starts at 1 (and is 1 when omitted). */
  search(context: { query: string; page?: number; options: Options }): Promise<Paged<TorrentResult>>
  /** Results for one of the manifest's Explore categories. */
  browse?(context: { category: string; page?: number; options: Options }): Promise<Paged<TorrentResult>>
}

/**
 * One entry of a public chart. It has no torrent: the app plays it by searching the user's providers for
 * `artist` + `title` (and, for songs, `album`), then starts the matching track.
 */
export interface ChartEntry {
  kind: 'album' | 'song'
  /** Album title, or the song title for songs */
  title: string
  artist: string
  /** Songs: the album it's on, which helps find it inside an album torrent */
  album?: string
  year?: string
  /** https image URL */
  artwork?: string
  /** Up to 4 short labels, e.g. a genre */
  tags?: string[]
}

/** A chart plugin (`"type": "chart"` in the manifest): Explore categories only, no search. */
export interface ChartPlugin {
  test?(context: { options: Options }): Promise<true>
  browse(context: { category: string; page?: number; options: Options }): Promise<Paged<ChartEntry>>
}

/**
 * One result of a stream plugin (`"type": "stream"`): a track or an album found by `search` or `browse`.
 * `id` is whatever `open` needs to find it again; the app never looks inside it.
 */
export interface StreamResult {
  id: string
  title: string
  artist?: string
  year?: string
  /** https image URL */
  artwork?: string
  /** Up to 4 short labels (12 characters each) */
  tags?: string[]
}

/** One playable track. `url` must be https, without a port, on a host the manifest declares (it may redirect anywhere public). */
export interface StreamTrack {
  title: string
  artist?: string
  url: string
  /** Sent with the audio requests: only User-Agent, Referer, Origin, Accept-Language, Cookie and Authorization. */
  headers?: Record<string, string>
  /** Seconds */
  duration?: number
  /** audio/* type, for when the server's own Content-Type says nothing useful */
  mime?: string
  /** Short label for the track list, e.g. MP3 */
  format?: string
}

/** What `open` returns: up to 500 tracks (one for a single song). */
export interface StreamAlbum {
  title?: string
  artist?: string
  artwork?: string
  tracks: StreamTrack[]
}

/**
 * A stream plugin: a service with direct audio URLs (Audius, a self-hosted server…). The app plays the tracks
 * itself, through a local proxy that handles seeking.
 */
export interface StreamPlugin {
  test?(context: { options: Options }): Promise<true>
  search(context: { query: string; page?: number; options: Options }): Promise<Paged<StreamResult>>
  browse?(context: { category: string; page?: number; options: Options }): Promise<Paged<StreamResult>>
  /** Called when the user opens a result: returns its tracks. */
  open(context: { id: string; options: Options }): Promise<StreamAlbum>
}
