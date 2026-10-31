// ListenBrainz charts: the most listened-to albums and songs across everyone who shares their listening history
// with ListenBrainz (the open, MetaBrainz-run alternative to Last.fm). Public API, no account or key needed.
// Entries have no torrents: the app plays them by searching the user's torrent sources (see ChartExtension in sdk.ts).
// API: https://listenbrainz.readthedocs.io/en/latest/users/api/statistics.html (sitewide statistics)

import { getJson } from './lib/torrent-kit.ts'
import type { ChartEntry, ChartExtension } from './sdk.ts'

const API = 'https://api.listenbrainz.org/1/stats/sitewide'
const SITE = 'ListenBrainz'
const LIMIT = 50

type Range = 'week' | 'month' | 'year' | 'all_time'

/** Keyed by the category ids in index.json. */
export const CATEGORIES: Record<string, { kind: ChartEntry['kind']; range: Range }> = {
  'week-albums': { kind: 'album', range: 'week' },
  'week-songs': { kind: 'song', range: 'week' },
  'month-albums': { kind: 'album', range: 'month' },
  'month-songs': { kind: 'song', range: 'month' },
  'year-albums': { kind: 'album', range: 'year' },
  'all-time-albums': { kind: 'album', range: 'all_time' }
}

interface Stat {
  artist_name?: string
  caa_id?: number
  caa_release_mbid?: string
  listen_count?: number
}

export interface ReleaseGroupStat extends Stat {
  release_group_mbid?: string
  release_group_name?: string
}

export interface RecordingStat extends Stat {
  recording_mbid?: string
  track_name?: string
  release_name?: string
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cover Art Archive thumbnail for a release, when ListenBrainz knows one. */
export function coverArt(stat: Stat): string | undefined {
  if (!stat.caa_release_mbid || !MBID.test(stat.caa_release_mbid) || !Number.isSafeInteger(stat.caa_id))
    return undefined
  return `https://coverartarchive.org/release/${stat.caa_release_mbid}/${stat.caa_id}-250.jpg`
}

/** One entry per album: several releases (editions) of the same album can each chart. */
export function parseReleaseGroups(groups: ReleaseGroupStat[]): ChartEntry[] {
  const seen = new Set<string>()
  return groups.flatMap(group => {
    if (!group?.release_group_name || !group.artist_name) return []
    const key = group.release_group_mbid ?? `${group.artist_name}\n${group.release_group_name}`.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [
      { kind: 'album' as const, title: group.release_group_name, artist: group.artist_name, artwork: coverArt(group) }
    ]
  })
}

export function parseRecordings(recordings: RecordingStat[]): ChartEntry[] {
  const seen = new Set<string>()
  return recordings.flatMap(recording => {
    if (!recording?.track_name || !recording.artist_name) return []
    const key = recording.recording_mbid ?? `${recording.artist_name}\n${recording.track_name}`.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        kind: 'song' as const,
        title: recording.track_name,
        artist: recording.artist_name,
        album: recording.release_name || undefined,
        artwork: coverArt(recording)
      }
    ]
  })
}

async function stats<T>(path: string, range: Range, count: number): Promise<T | undefined> {
  const url = `${API}/${path}?range=${range}&count=${count}`
  const body = await getJson<{ payload?: T }>(url, SITE)
  return body.payload
}

const extension: ChartExtension = {
  async test() {
    const payload = await stats<{ release_groups?: unknown[] }>('release-groups', 'week', 1)
    if (!payload?.release_groups?.length) throw new Error('ListenBrainz has no chart for this week yet.')
    return true
  },

  async browse({ category }) {
    const { kind, range } = CATEGORIES[category] ?? CATEGORIES['week-albums']
    // Ask for extra: duplicates (other editions of the same album) are dropped.
    if (kind === 'album') {
      const payload = await stats<{ release_groups?: ReleaseGroupStat[] }>('release-groups', range, LIMIT + 25)
      return parseReleaseGroups(payload?.release_groups ?? []).slice(0, LIMIT)
    }
    const payload = await stats<{ recordings?: RecordingStat[] }>('recordings', range, LIMIT + 25)
    return parseRecordings(payload?.recordings ?? []).slice(0, LIMIT)
  }
}

export default extension
