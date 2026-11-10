import type { ChartRegion, SourceCategory, SourceHints } from '../../shared/types.ts'
import type { TrackAnnotation } from '../engine.ts'

/**
 * A music provider turns a text query into albums/songs and turns a chosen album into something playable.
 *
 * Adding a source means writing one of these and registering its settings type (see settings.ts):
 * - torrent indexers / trackers return `{ kind: 'torrent' }` playables (magnet URI or .torrent bytes);
 * - a website or API that serves .torrent files does the same;
 * - a service with direct audio URLs returns `{ kind: 'http' }` playables, which HttpSource (http-source.ts) plays
 *   through the loopback stream server, next to TorrentEngine.
 */
export interface MusicProvider {
  /** Stable, unique id: [a-z0-9-] */
  readonly id: string
  readonly name: string
  /** How the UI lays out this provider's albums: artwork cards, or rows for torrent releases. */
  readonly layout: 'cards' | 'list'
  /** `page` starts at 1; later pages are only asked for when the previous one said `hasMore`. */
  search(query: string, signal: AbortSignal, page?: number): Promise<ProviderResults>
  open(album: ProviderAlbum, signal?: AbortSignal): Promise<Playable>
  /** Categories for the Explore page (trending, genres, formats…). Omit if the source can't be browsed. */
  readonly categories?: SourceCategory[]
  /** `region`: a country code (or "" for worldwide) to use instead of the saved one, for charts that have a `region`. */
  browse?(categoryId: string, signal: AbortSignal, page?: number, region?: string): Promise<ProviderResults>
  /** Charts that can be asked for another country. */
  readonly region?: ChartRegion
  /**
   * Chart sources (top albums/songs) list music without torrents: they're only browsed, never searched, and
   * opening an entry finds a matching release on the other providers (see ProviderRegistry.findRelease).
   */
  readonly chart?: boolean
}

export interface ProviderAlbum {
  /**
   * Provider-private locator (archive id, magnet URI, indexer download link...). It never leaves the main
   * process — the renderer only sees an opaque result id — so a compromised renderer can't make us fetch
   * arbitrary URLs through it.
   */
  ref: string
  title: string
  artist?: string
  year?: string
  license?: string
  /** https image URL */
  artwork?: string
  seeders?: number
  peers?: number
  size?: number
  /** Short labels such as FLAC, MP3 320 */
  tags?: string[]
  /** Set for chart entries: an album or a song that opens by searching the providers for it. */
  chart?: 'album' | 'song'
}

export interface ProviderSong {
  /** Song key inside the album's torrent (see library.trackKey) */
  key: string
  title: string
  artist?: string
  duration?: number
  album: ProviderAlbum
}

export interface ProviderResults {
  albums: ProviderAlbum[]
  songs: ProviderSong[]
  /** Another page of albums can be asked for. */
  hasMore?: boolean
}

export type Playable = TorrentPlayable | HttpPlayable

export interface TorrentPlayable {
  kind: 'torrent'
  /** Magnet URI or .torrent file contents */
  torrent: string | Uint8Array
  /** Album title/artist to show instead of the torrent's name */
  hints?: SourceHints
  /** Better titles/durations for the tracks, keyed by trackKey; may resolve to null. */
  annotations?: Promise<Map<string, TrackAnnotation> | null>
  /** The song to start with once loaded (chart songs found inside an album torrent). */
  startAt?: { title: string; artist?: string }
}

/** One track of an http album: an https audio file the stream server proxies (with Range) to the player. */
export interface HttpTrack {
  title: string
  artist?: string
  /** https audio URL; redirects are followed (public hosts only) */
  url: string
  /** Extra request headers for the upstream, e.g. User-Agent or Referer (allow-list: manifest.ts HTTP_HEADERS) */
  headers?: Record<string, string>
  /** Seconds */
  duration?: number
  /** audio/* type, for when the upstream's own Content-Type says nothing useful */
  mime?: string
  /** Short label for the track list, e.g. MP3 */
  format?: string
}

export interface HttpPlayable {
  kind: 'http'
  /** 40 hex characters, stable per provider and source id; stands in for the torrent info hash everywhere */
  id: string
  title: string
  artist?: string
  /** https image URL */
  coverUrl?: string
  tracks: HttpTrack[]
  hints?: SourceHints
  /** The song to start with once loaded (chart songs found in an http album). */
  startAt?: { title: string; artist?: string }
}
