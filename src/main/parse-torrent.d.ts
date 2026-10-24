declare module 'parse-torrent' {
  export interface ParsedTorrent {
    infoHash: string
    name?: string
    announce?: string[]
    urlList?: string[]
    info?: unknown
    [key: string]: unknown
  }
  export default function parseTorrent(torrentId: string | Uint8Array | ParsedTorrent): Promise<ParsedTorrent>
  export function toTorrentFile(parsed: ParsedTorrent): Uint8Array
}
