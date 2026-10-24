import type { SourceCategory, SourceHints } from '../../shared/types.ts'
import type { TrackAnnotation } from '../engine.ts'

/**
 * A music provider turns a text query into albums/songs and turns a chosen album into something playable.
 *
 * Adding a source means writing one of these and registering its settings type (see settings.ts):
 * - torrent indexers / trackers return `{ kind: 'torrent' }` playables (magnet URI or .torrent bytes);
 * - a website or API that serves .torrent files does the same;
 * - a direct HTTP stream source would add a new Playable kind (e.g. `{ kind: 'http', tracks }`) plus a
 *   playback backend next to TorrentEngine that implements `resolveFile` for the loopback stream server.
 */
export interface MusicProvider {
  /** Stable, unique id: [a-z0-9-] */
  readonly id: string
  readonly name: string
  /** How the UI lays out this provider's albums: artwork cards, or rows for torrent releases. */
  readonly layout: 'cards' | 'list'
  search(query: string, signal: AbortSignal): Promise<ProviderResults>
  open(album: ProviderAlbum, signal?: AbortSignal): Promise<Playable>
  /** Categories for the Explore page (trending, genres, formats…). Omit if the source can't be browsed. */
  readonly categories?: SourceCategory[]
  browse?(categoryId: string, signal: AbortSignal): Promise<ProviderResults>
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
}

export type Playable = {
  kind: 'torrent'
  /** Magnet URI or .torrent file contents */
  torrent: string | Uint8Array
  /** Album title/artist to show instead of the torrent's name */
  hints?: SourceHints
  /** Better titles/durations for the tracks, keyed by trackKey; may resolve to null. */
  annotations?: Promise<Map<string, TrackAnnotation> | null>
}
