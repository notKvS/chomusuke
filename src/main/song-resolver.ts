import type { Album, SongRef } from '../shared/types.ts'
import { logger } from './log.ts'
import { type ChartWanted, chartQueries, findTrack, rankReleases } from './providers/chart-match.ts'
import type { MusicProvider, Playable, ProviderAlbum } from './providers/types.ts'
import { SourceError } from './source.ts'

const log = logger('songs')

type Delivery = 'torrent' | 'http'

/** How long one provider may take to answer a search. */
const SEARCH_TIMEOUT_MS = 25_000
/** Best-ranked results tried per provider: one may fail to open or not hold the song after all. */
const ATTEMPTS_PER_PROVIDER = 3
/** A found track must be this close (seconds) to the saved song's length, when both are known: not a live cut or remix. */
const DURATION_TOLERANCE_S = 10

/** A provider that is gone, by what is left of its id: 'plugin-youtube-music' → 'Youtube Music'. */
const nameOf = (providerId: string): string =>
  providerId
    .replace(/^plugin-/, '')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/** What the resolver needs from the providers: the enabled ones, in the user's order. */
export interface SongSources {
  providersOf(delivery: Delivery): MusicProvider[]
  provider(id: string): MusicProvider | undefined
}

/** How a song's source is opened. */
export interface SongLoaders {
  /** A torrent from its magnet link */
  magnet(magnet: string, hints: { title?: string; artist?: string }): Promise<Album>
  /** What a provider found: its torrent, or its http tracks */
  playable(playable: Playable): Promise<Album>
}

export interface ResolvedSong {
  album: Album
  /** The track in `album` that is the song */
  startKey: string
  /** Set when the song comes from somewhere else than the source it was saved from */
  notice?: string
}

/**
 * Finds a saved song (a like, a playlist entry) again, wherever it can still be played from.
 *
 *  1. The source it was saved from: its torrent, or its stream plugin.
 *  2. Other providers of the same kind, in the user's order (the first one that has the exact song wins).
 *  3. Providers of the other kind: a streaming song is searched for among the torrent plugins, a torrent song among
 *     the streaming ones.
 *
 * "Exact" means the same artist and title as saved (chart-match.ts: lead artist, title words, no karaoke or tribute
 * releases), the song being found among the opened album's tracks, and a similar length when both are known.
 * When the song comes from another source, `notice` says so; when it is nowhere, the error asks the user to turn on
 * other plugins.
 */
export class SongResolver {
  private readonly sources: SongSources
  private readonly load: SongLoaders

  constructor(sources: SongSources, load: SongLoaders) {
    this.sources = sources
    this.load = load
  }

  async resolve(song: SongRef, signal?: AbortSignal): Promise<ResolvedSong> {
    const original = await this.fromOrigin(song, signal)
    if (original.found) return original.found

    const searched: Delivery[] = []
    const kinds: Delivery[] = song.http ? ['http', 'torrent'] : ['torrent', 'http']
    for (const delivery of kinds) {
      // The provider the song came from has been tried already.
      const providers = this.sources.providersOf(delivery).filter(p => p.id !== song.http?.provider)
      if (providers.length === 0) continue
      searched.push(delivery)
      const found = await this.search(song, providers, signal)
      if (found) {
        log.info(`“${song.title}” found on ${found.provider.id} (it was saved from ${original.name})`)
        return { album: found.album, startKey: found.startKey, notice: switched(song, original, found.provider) }
      }
    }
    log.warn(`“${song.title}” by ${song.artist ?? 'unknown'} wasn’t found on: ${searched.join(', ') || 'no plugins'}`)
    throw new SourceError(notFound(song, searched))
  }

  /** The source the song was saved from. */
  private async fromOrigin(song: SongRef, signal?: AbortSignal): Promise<Origin> {
    try {
      if (song.http) {
        const provider = this.sources.provider(song.http.provider)
        const name = provider?.name ?? nameOf(song.http.provider)
        if (!provider) return { name, off: true }
        const playable = await provider.open(
          { ref: JSON.stringify({ id: song.http.id }), title: song.title, artist: song.artist },
          signal
        )
        const album = await this.load.playable(playable)
        const startKey = pickKey(album, song)
        return startKey ? { name, found: { album, startKey } } : { name }
      }
      if (song.magnet) {
        const album = await this.load.magnet(song.magnet, { title: song.album, artist: song.artist })
        const startKey = pickKey(album, song)
        return startKey ? { name: 'its torrent', found: { album, startKey } } : { name: 'its torrent' }
      }
    } catch (err) {
      if (signal?.aborted) throw err
      log.warn(`“${song.title}” didn’t open from where it was saved:`, err)
    }
    return { name: song.http ? nameOf(song.http.provider) : 'its torrent' }
  }

  /**
   * The first provider, in order, that has the exact song. All searches start at once; they are looked at in the
   * user's order, and the rest are dropped as soon as one has it.
   */
  private async search(
    song: SongRef,
    providers: MusicProvider[],
    outer?: AbortSignal
  ): Promise<{ album: Album; startKey: string; provider: MusicProvider } | undefined> {
    const stop = new AbortController()
    const signal = outer ? AbortSignal.any([outer, stop.signal]) : stop.signal
    const wanted: ChartWanted = { kind: 'song', title: song.title, artist: song.artist ?? '', album: song.album }
    const queries = chartQueries(wanted)
    const ranked = providers.map(provider => this.rank(provider, queries, wanted, signal))
    try {
      for (const [index, provider] of providers.entries()) {
        for (const result of (await ranked[index]).slice(0, ATTEMPTS_PER_PROVIDER)) {
          try {
            const album = await this.load.playable(await provider.open(result, signal))
            const startKey = pickKey(album, song, true)
            if (startKey && closeInLength(album, startKey, song)) return { album, startKey, provider }
            log.debug(`${provider.id}: “${result.title}” isn’t the song after all`)
          } catch (err) {
            if (signal.aborted) throw err
            log.warn(`${provider.id}: “${result.title}” didn’t open:`, err)
          }
        }
      }
      return undefined
    } finally {
      stop.abort()
    }
  }

  /** One provider's results for the song, best first: the first of the queries that finds anything that matches. */
  private async rank(
    provider: MusicProvider,
    queries: string[],
    wanted: ChartWanted,
    signal: AbortSignal
  ): Promise<ProviderAlbum[]> {
    for (const query of queries) {
      try {
        const results = await provider.search(query, AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]))
        const candidates = [...results.albums, ...results.songs.map(s => s.album)].map(album => ({ album }))
        const matches = rankReleases(wanted, candidates).map(c => c.album)
        if (matches.length > 0) return matches
      } catch (err) {
        if (signal.aborted) return []
        log.warn(`${provider.id} couldn’t search for “${query}”:`, err)
        return []
      }
    }
    log.warn(`${provider.name} (${provider.id}) has no match for “${wanted.title}” by ${wanted.artist}`)
    return []
  }
}

interface Origin {
  /** Where it was saved from, for the notice */
  name: string
  /** The plugin it was saved from is turned off or removed */
  off?: boolean
  found?: { album: Album; startKey: string }
}

/**
 * The track of an opened album that is the song: the saved track key when the album is the same one, else the track
 * with the same title. A one-track album from where the song was saved is the song itself.
 */
function pickKey(album: Album, song: SongRef, strict = false): string | undefined {
  const same = album.tracks.find(t => t.key === song.key)
  if (same && !strict) return same.key
  const byTitle = findTrack(album.tracks, { title: song.title, artist: song.artist })
  if (byTitle) return byTitle
  return !strict && album.tracks.length === 1 ? album.tracks[0].key : undefined
}

function closeInLength(album: Album, key: string, song: SongRef): boolean {
  const length = album.tracks.find(t => t.key === key)?.duration
  return !song.duration || !length || Math.abs(length - song.duration) <= DURATION_TOLERANCE_S
}

function switched(song: SongRef, from: Origin, to: MusicProvider): string {
  if (!song.http) return `The torrent for “${song.title}” didn’t load, so it’s playing from ${to.name}.`
  return from.off
    ? `${from.name} is turned off, so “${song.title}” is playing from ${to.name}.`
    : `“${song.title}” isn’t available from ${from.name} right now, so it’s playing from ${to.name}.`
}

function notFound(song: SongRef, searched: Delivery[]): string {
  const what = `“${song.title}”${song.artist ? ` by ${song.artist}` : ''}`
  if (searched.length === 0) return `No plugins are turned on to find ${what}. Turn some on in Settings → Plugins.`
  return `Couldn’t find ${what} on your enabled plugins. Turn on other plugins in Settings → Plugins to search them too.`
}
