export interface Track {
  /** Stable id: `${infoHash}:${fileIndex}` */
  id: string
  fileIndex: number
  title: string
  artist?: string
  trackNo?: number
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

export interface ChomusukeApi {
  loadSource(source: string, hints?: SourceHints): Promise<LoadResult>
  openTorrentFile(): Promise<LoadResult | null>
  onStats(listener: (stats: TorrentStats[]) => void): () => void
}
