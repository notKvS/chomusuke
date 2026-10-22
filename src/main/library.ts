export interface TorrentFileInfo {
  /** Path inside the torrent, including the torrent name for multi-file torrents */
  path: string
  length: number
}

export interface LibraryTrack {
  fileIndex: number
  title: string
  artist?: string
  trackNo?: number
  format: string
  size: number
}

export interface Library {
  title: string
  artist?: string
  tracks: LibraryTrack[]
  coverIndex?: number
}

/** Lower is preferred when the same song is present in several formats. */
const AUDIO_RANK: Record<string, number> = {
  mp3: 0,
  m4a: 1,
  aac: 1,
  opus: 2,
  ogg: 2,
  oga: 2,
  flac: 3,
  wav: 4
}
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAX_COVER_BYTES = 15 * 1024 * 1024
// archive.org ships derivatives next to originals: song_vbr.mp3, song_64kb.mp3, song_320kb.mp3
const DERIVATIVE_SUFFIX = /_(?:vbr|\d{2,3}kbp?s?)$/i
const LOW_BITRATE_SUFFIX = /_(?:32|48|64|96)kbp?s?$/i
const LEADING_TRACK_NO = /^(\d{1,3})(?:\s*[-.)]\s*|\s+)(?=\S)/
const COVER_HINT = /cover|folder|front|album|artwork/i
const NOT_COVER_HINT = /back|inlay|tray|disc|thumb|\bcd\b/i

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

interface ParsedFile {
  index: number
  dir: string
  stem: string
  ext: string
  length: number
}

function parseFile(file: TorrentFileInfo, index: number): ParsedFile | null {
  const parts = file.path.split(/[\\/]/)
  // Skip BEP 47 padding files, dot files (macOS ._ resource forks) and __MACOSX folders.
  if (parts.some(part => part.startsWith('.') || part === '__MACOSX')) return null
  const name = parts[parts.length - 1]
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return {
    index,
    dir: parts.slice(0, -1).join('/'),
    stem: name.slice(0, dot),
    ext: name.slice(dot + 1).toLowerCase(),
    length: file.length
  }
}

const prettify = (text: string): string => text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
const songKey = (file: ParsedFile): string => `${file.dir}/${file.stem.replace(DERIVATIVE_SUFFIX, '')}`.toLowerCase()

function audioRank(file: ParsedFile): number {
  const derivative = DERIVATIVE_SUFFIX.test(file.stem)
  const lowBitrate = LOW_BITRATE_SUFFIX.test(file.stem)
  return AUDIO_RANK[file.ext] + (lowBitrate ? 10 : 0) + (derivative ? 0.1 : 0)
}

function coverScore(file: ParsedFile): number {
  const name = `${file.dir}/${file.stem}`
  let score = file.ext === 'jpg' || file.ext === 'jpeg' ? 1 : 0
  if (COVER_HINT.test(file.stem)) score += 4
  if (NOT_COVER_HINT.test(name)) score -= 2
  return score
}

function parseTitle(stem: string): { title: string; trackNo?: number } {
  const pretty = prettify(stem.replace(DERIVATIVE_SUFFIX, ''))
  const match = LEADING_TRACK_NO.exec(pretty)
  if (!match) return { title: pretty }
  return { title: pretty.slice(match[0].length), trackNo: Number(match[1]) }
}

/** Turns a torrent's raw file list into an ordered, de-duplicated track list plus a cover image. */
export function buildLibrary(torrentName: string, files: TorrentFileInfo[]): Library {
  const parsed = files.map(parseFile).filter((file): file is ParsedFile => file !== null)

  const bestPerSong = new Map<string, ParsedFile>()
  for (const file of parsed) {
    if (!(file.ext in AUDIO_RANK)) continue
    const key = songKey(file)
    const current = bestPerSong.get(key)
    if (!current || audioRank(file) < audioRank(current)) bestPerSong.set(key, file)
  }

  let tracks = [...bestPerSong.values()]
    .map(file => ({ file, ...parseTitle(file.stem) }))
    .sort(
      (a, b) =>
        naturalCompare(a.file.dir, b.file.dir) ||
        (a.trackNo ?? Infinity) - (b.trackNo ?? Infinity) ||
        naturalCompare(a.title, b.title)
    )
    .map(({ file, title, trackNo }): LibraryTrack => ({
      fileIndex: file.index,
      title,
      trackNo,
      format: file.ext.toUpperCase(),
      size: file.length
    }))

  let artist: string | undefined
  const prefixes = new Set(tracks.map(t => (t.title.includes(' - ') ? t.title.split(' - ')[0].toLowerCase() : '')))
  if (tracks.length > 0 && prefixes.size === 1 && !prefixes.has('')) {
    artist = tracks[0].title.split(' - ')[0]
    tracks = tracks.map(t => ({ ...t, artist, title: t.title.slice(t.title.indexOf(' - ') + 3) }))
  }

  const songKeys = new Set(bestPerSong.keys())
  const cover = tracks.length
    ? parsed
        .filter(f => IMAGE_EXTENSIONS.has(f.ext) && f.length <= MAX_COVER_BYTES && !songKeys.has(songKey(f)))
        .sort((a, b) => coverScore(b) - coverScore(a) || b.length - a.length)[0]
    : undefined

  const audioExt = new RegExp(`\\.(?:${Object.keys(AUDIO_RANK).join('|')})$`, 'i')
  return {
    title: prettify(torrentName.replace(audioExt, '')),
    artist,
    tracks,
    coverIndex: cover?.index
  }
}
