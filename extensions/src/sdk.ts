/**
 * Types for writing Chomusuke extensions. An extension is a TypeScript module whose default export implements
 * `Extension` (a torrent source) or `ChartExtension` (a public chart whose entries play through the torrent sources).
 * `npm run build:extensions` bundles each one into a single ES module in `extensions/dist/`,
 * which the app loads into a sandboxed Web Worker (no DOM, no Node; fetch() only to the manifest's hosts).
 * Manifest format: see src/main/extension-host/manifest.ts and extensions/index.json.
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
  /** Up to 4 short labels, e.g. FLAC, CC BY */
  tags?: string[]
}

export type Options = Record<string, string | boolean>

export interface Extension {
  /** Self-check for the Sources page; return true or throw an Error with a user-facing message. */
  test?(context: { options: Options }): Promise<true>
  search(context: { query: string; options: Options }): Promise<TorrentResult[]>
  /** Results for one of the manifest's Explore categories. */
  browse?(context: { category: string; options: Options }): Promise<TorrentResult[]>
}

/**
 * One entry of a public chart. It has no torrent: the app plays it by searching the user's torrent sources for
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

/** A chart extension (`"type": "chart"` in the manifest): Explore categories only, no search. */
export interface ChartExtension {
  test?(context: { options: Options }): Promise<true>
  browse(context: { category: string; options: Options }): Promise<ChartEntry[]>
}
