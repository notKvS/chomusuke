// Finding a chart entry (an album or song from a public chart) among torrent search results, and the song inside
// the torrent once it has loaded. Release names are messy ("Artist - Album (2024) [FLAC 24-96]"), so matching
// works on normalised words: every artist and title word should be in the release name, extra words cost a little,
// seeders help, and karaoke/tribute/cover releases are skipped unless the chart entry itself is one.

import { normalizeText, songFingerprint, stripReleaseInfo } from '../../shared/fingerprint.ts'
import type { ProviderAlbum } from './types.ts'

/** A chart entry to find on the torrent sources. */
export interface ChartWanted {
  kind: 'album' | 'song'
  /** Album title, or the song title for songs */
  title: string
  artist: string
  /** Songs only: the album it's on, when the chart says */
  album?: string
}

const MAX_QUERIES = 3
const MAX_QUERY_LENGTH = 200
/** Share of the wanted title words a release name must contain. */
const MIN_TITLE_COVERAGE = 0.75

/** Store suffixes on chart titles ("Song - Single", "Album - EP") that release names don't carry. */
const STORE_SUFFIX = /\s+[-–—]\s+(?:single|ep)\s*$/i
/** Releases of other people performing the music. */
const KNOCKOFF = new Set([
  'karaoke',
  'tribute',
  'cover',
  'covers',
  'instrumental',
  'instrumentals',
  'lullaby',
  'lullabies',
  'acapella',
  'ringtone',
  'ringtones',
  'nightcore',
  'sped',
  'slowed'
])
/** Words in release names that say nothing about which music it is. */
const NOISE = new Set(
  'the a an and of feat ft featuring with flac mp3 aac alac ogg opus wav kbps v0 web webrip cd vinyl lossless hires hi res bit khz album deluxe edition expanded remaster remastered explicit clean single ep va various artists'.split(
    ' '
  )
)
const COLLECTION = /\b(?:discography|anthology|complete albums|greatest hits|the best of)\b/

/** Normalised words; apostrophes join ("Taylor's" = "Taylors"). */
const words = (text: string): string[] =>
  normalizeText(text.replace(/['’ʼ`]/g, ''))
    .split(' ')
    .filter(Boolean)

/** A chart title without store suffixes, edition tags or guest artists. */
const cleanTitle = (text: string): string => stripReleaseInfo(text.replace(STORE_SUFFIX, '')).trim()

/** The first of several credited artists: "Lady Gaga & Bruno Mars" → "Lady Gaga". Only used to widen searches. */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|\s\+\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bx\s|\bwith\s)\s*/i)[0]?.trim() || artist
}

/** Words that join or decorate artist names ("The Weeknd", "A & B", "feat."), not part of who it is. */
const ARTIST_FILLER = new Set(['the', 'a', 'an', 'and', 'of', 'feat', 'ft', 'featuring', 'with', 'x', 'vs'])

/** An artist credit's meaningful words; "The The" keeps its words rather than becoming nothing. */
function artistWords(text: string): string[] {
  const all = words(text)
  const meaningful = all.filter(word => !ARTIST_FILLER.has(word))
  return meaningful.length > 0 ? meaningful : all
}

interface Credit {
  /** Every word of every credited artist, guests included */
  all: Set<string>
  /** The first credited artist's words: a release must name them in full */
  lead: string[]
}

function creditOf(artist: string): Credit {
  const lead = artistWords(
    artist.split(/\s*(?:,|&|\s\+\s|\band\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bx\s|\bwith\s|\bvs\.?\s)\s*/i)[0] ?? ''
  )
  return { all: new Set(artistWords(artist)), lead: lead.length > 0 ? lead : artistWords(artist) }
}

/** Who a release is by: its artist field, or either side of "A - B" (names come both ways round). */
function releaseArtists(release: ProviderAlbum): string[] {
  if (release.artist) return [release.artist]
  const dash = /\s[-–—]\s/.exec(release.title)
  if (!dash) return []
  return [release.title.slice(0, dash.index), release.title.slice(dash.index + dash[0].length)]
}

/**
 * Whether a release is by the credited artist: its named artist must be the lead artist, with nobody else
 * ("Paul Simon" isn't "Simon & Garfunkel", "Bonnie Tyler" isn't "Tyler, The Creator") other than co-credited ones.
 * Without a named artist, the lead artist's words must all be somewhere in the name.
 */
function byArtist(credit: Credit, release: ProviderAlbum, nameWords: Set<string>): boolean {
  const named = releaseArtists(release)
  if (named.length === 0) return credit.lead.every(word => nameWords.has(word))
  return named.some(side => {
    const found = artistWords(stripReleaseInfo(side))
    return (
      found.length > 0 && found.every(word => credit.all.has(word)) && credit.lead.every(word => found.includes(word))
    )
  })
}

function coverage(wanted: string[], found: Set<string>): number {
  if (wanted.length === 0) return 0
  return wanted.filter(word => found.has(word)).length / wanted.length
}

/** Search terms to try, most specific first: artist + title, then the album (songs), then the first artist only. */
export function chartQueries(wanted: ChartWanted): string[] {
  const artist = wanted.artist.trim()
  const lead = primaryArtist(artist)
  const title = cleanTitle(wanted.title)
  const album = wanted.album ? cleanTitle(wanted.album) : ''
  const candidates =
    wanted.kind === 'album'
      ? [`${artist} ${title}`, `${lead} ${title}`]
      : [`${artist} ${title}`, album && `${lead} ${album}`, `${lead} ${title}`]
  const seen = new Set<string>()
  const queries: string[] = []
  for (const candidate of candidates) {
    const query = (candidate || '')
      .replace(/[^\p{L}\p{M}\p{N}'&]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_QUERY_LENGTH)
    const key = words(query).join(' ')
    if (!key || seen.has(key)) continue
    seen.add(key)
    queries.push(query)
  }
  return queries.slice(0, MAX_QUERIES)
}

/**
 * How well a release matches a chart entry (higher is better), or undefined when it doesn't: wrong artist or title,
 * a karaoke/tribute/cover release, or a dead torrent.
 */
export function scoreRelease(wanted: ChartWanted, release: ProviderAlbum): number | undefined {
  if (release.seeders === 0) return undefined
  const name = `${release.artist ?? ''} ${release.title}`
  const found = words(name)
  const foundSet = new Set(found)

  const credit = creditOf(wanted.artist)
  const titleWords = words(cleanTitle(wanted.title))
  const albumWords = wanted.album ? words(cleanTitle(wanted.album)) : []
  const wantedSet = new Set([...words(wanted.artist), ...titleWords, ...albumWords])
  if (found.some(word => KNOCKOFF.has(word) && !wantedSet.has(word))) return undefined
  if (!byArtist(credit, release, foundSet)) return undefined

  let titleMatch = coverage(titleWords, foundSet)
  let penalty = 0
  if (wanted.kind === 'song' && titleMatch < MIN_TITLE_COVERAGE) {
    // The song is usually inside an album torrent: the album's name, or the artist's discography, will do.
    const albumMatch = coverage(albumWords, foundSet)
    if (albumMatch >= MIN_TITLE_COVERAGE) titleMatch = albumMatch
    else if (COLLECTION.test(found.join(' '))) {
      titleMatch = MIN_TITLE_COVERAGE
      penalty += 20
    }
  }
  if (titleMatch < MIN_TITLE_COVERAGE) return undefined

  const extra = found.filter(word => !wantedSet.has(word) && !NOISE.has(word) && !/^\d+$/.test(word)).length
  penalty += Math.min(extra * 3, 30)
  // Peers make playback start fast; unknown counts (web-seeded archives) get a modest bonus.
  const seeding = release.seeders === undefined ? 8 : Math.min(Math.log2(release.seeders + 1) * 5, 40)
  return titleMatch * 60 + seeding - penalty
}

/** Matching releases, best first. */
export function rankReleases<T extends { album: ProviderAlbum }>(wanted: ChartWanted, candidates: T[]): T[] {
  return candidates
    .flatMap(candidate => {
      const score = scoreRelease(wanted, candidate.album)
      return score === undefined ? [] : [{ candidate, score }]
    })
    .sort((a, b) => b.score - a.score)
    .map(({ candidate }) => candidate)
}

const titlePart = (fingerprint: string | undefined): string | undefined => fingerprint?.split('|')[1]

/**
 * The key of the track that is the wanted song: same title (ignoring track numbers, edition tags, guests and an
 * "Artist - " prefix), otherwise the shortest title that contains it.
 */
export function findTrack(
  tracks: ReadonlyArray<{ key: string; title: string; artist?: string }>,
  song: { title: string; artist?: string }
): string | undefined {
  const target =
    titlePart(songFingerprint(cleanTitle(song.title), song.artist || 'unknown')) ?? normalizeText(song.title)
  if (!target) return undefined
  const credit = song.artist ? creditOf(song.artist) : undefined
  // A track tagged with someone else entirely (a compilation, a split release) isn't the song.
  const byOther = (track: { artist?: string }) =>
    credit !== undefined && track.artist !== undefined && !artistWords(track.artist).some(w => credit.all.has(w))
  const titles = tracks
    .filter(track => !byOther(track))
    .map(track => ({
      key: track.key,
      names: [songFingerprint(track.title, track.artist ?? song.artist), songFingerprint(track.title)]
        .map(titlePart)
        .filter((name): name is string => Boolean(name))
    }))
  const exact = titles.find(track => track.names.includes(target))
  if (exact) return exact.key
  if (target.length < 3) return undefined
  const containing = titles
    .flatMap(track =>
      track.names.filter(name => ` ${name} `.includes(` ${target} `)).map(name => ({ key: track.key, name }))
    )
    .sort((a, b) => a.name.length - b.name.length)
  return containing[0]?.key
}
