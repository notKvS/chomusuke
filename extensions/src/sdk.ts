/**
 * Types for writing Chomusuke extensions. An extension is a TypeScript module whose default export implements
 * `Extension`. `npm run build:extensions` bundles each one into a single ES module in `extensions/dist/`,
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
