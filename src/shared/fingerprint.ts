// Song identity across sources. A rating is stored against the exact file (`<infoHash>:<track key>`), which is
// the same no matter which provider found the torrent. The fingerprint links the same song in *other* torrents
// (another rip, a discography, a different tracker): normalised artist + title.

/** Words that describe the release or file, not the song: dropped when they're in brackets or after " - ". */
const RELEASE_WORDS =
  /\b(?:remaster(?:ed)?|mono|stereo|bonus(?: track)?|explicit|clean|deluxe|edition|single version|album version|radio edit|single edit|flac|mp3|aac|alac|ogg|opus|wav|lossless|hi-?res|\d{2,3} ?kbps|320|v0|24[- ]?bit|16[- ]?bit|web|cd|vinyl|(?:19|20)\d{2})\b/i

/**
 * Guest artists: "(feat. X)", "[with X]", or a trailing "feat. X". Band names like "Simon & Garfunkel" and
 * titles like "With or Without You" stay whole.
 */
const FEATURING = [/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, /\s+(?:feat\.?|ft\.?|featuring)\s.*$/i]

const LEADING_NUMBER = /^\s*\d{1,3}(?:\s*[.)-]\s*|\s+)/

/** Removes edition/format tags and guest artists; different recordings ("Live", "Acoustic") are kept. */
function stripReleaseInfo(text: string): string {
  let value = text.replace(/_/g, ' ')
  value = value.replace(/\s*[([{]([^)\]}]*)[)\]}]/g, (group, inner: string) => (RELEASE_WORDS.test(inner) ? '' : group))
  value = value.replace(/\s+[-–—]\s+([^-–—]+)$/, (suffix, inner: string) => (RELEASE_WORDS.test(inner) ? '' : suffix))
  for (const pattern of FEATURING) value = value.replace(pattern, ' ')
  return value
}

/**
 * Lower-case letters and digits only. Latin accents are removed ("Beyoncé" = "Beyonce"), but marks that change
 * the letter in other scripts (Japanese voicing marks, Devanagari vowel signs…) are kept.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * "artist|title" for matching the same song in different torrents; undefined when the title is too generic
 * to match safely (e.g. "Track 01", "Intro" without an artist).
 */
export function songFingerprint(title: string, artist?: string): string | undefined {
  let rawTitle = title.replace(LEADING_NUMBER, '')
  let rawArtist = artist
  // "Artist - Title" in the file name and no artist tag: split it.
  const dash = /\s[-–—]\s/.exec(rawTitle)
  if (!rawArtist && dash) {
    rawArtist = rawTitle.slice(0, dash.index)
    rawTitle = rawTitle.slice(dash.index + dash[0].length)
  }
  const t = normalizeText(stripReleaseInfo(rawTitle))
  const a = rawArtist ? normalizeText(stripReleaseInfo(rawArtist)).replace(/^the\s+/, '') : ''
  if (!t || /^(?:track|audio|untitled)?\s*\d*$/.test(t)) return undefined
  if (!a && t.length < 6) return undefined
  return `${a}|${t}`
}

export const songId = (infoHash: string, key: string): string => `${infoHash}:${key}`
