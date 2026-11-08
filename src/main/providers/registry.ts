import { createHash } from 'node:crypto'
import { parseRegion } from '../../shared/regions.ts'
import type { ExploreOverview, ProviderSection, SearchAlbum, SearchResults, SearchSong } from '../../shared/types.ts'
import { logger } from '../log.ts'
import { SourceError } from '../source.ts'
import { type ChartWanted, chartQueries, rankReleases } from './chart-match.ts'
import { TorznabError } from './torznab.ts'
import type { MusicProvider, Playable, ProviderAlbum, ProviderResults } from './types.ts'

const log = logger('search')

const PROVIDER_TIMEOUT_MS = 25_000
/** How long a chart shelf waits for missing covers before showing what it has. */
const COVERS_TIMEOUT_MS = 8000
const MAX_REMEMBERED_RESULTS = 5000
const RESULT_ID = /^[a-z0-9-]{1,40}:[a-f0-9]{24}$/
/** Best-ranked releases tried, in order, when opening a chart entry (one may fail to download). */
const CHART_ATTEMPTS = 3
/** How long a chart page is kept, so reopening Explore or switching back to a category doesn't fetch it again. */
const BROWSE_CACHE_MS = 10 * 60_000
const MAX_BROWSE_CACHE = 200
/** How far "Load more" can go for one search or category. */
export const MAX_PAGE = 20

type Candidate = { provider: MusicProvider; album: ProviderAlbum }

/** Adds covers to chart entries that came without one (see covers.ts). */
export type CoverFill = (albums: ProviderAlbum[], signal: AbortSignal) => Promise<ProviderAlbum[]>

/**
 * Fans a query out to every enabled provider and remembers which provider/locator each result came from,
 * so the renderer can open a result by opaque id without ever handling URLs, magnets or API keys.
 */
export class ProviderRegistry {
  private providers: MusicProvider[] = []
  private readonly results = new Map<string, { provider: MusicProvider; album: ProviderAlbum }>()
  private readonly browsed = new Map<string, { at: number; section: ProviderSection }>()

  private readonly fillCovers?: CoverFill

  constructor(fillCovers?: CoverFill) {
    this.fillCovers = fillCovers
  }

  setProviders(providers: MusicProvider[]): void {
    this.providers = providers
    this.browsed.clear()
    // Results from providers that were removed or reconfigured can no longer be opened.
    for (const [id, entry] of this.results) {
      if (!providers.includes(entry.provider)) this.results.delete(id)
    }
  }

  get size(): number {
    return this.providers.length
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResults> {
    const providers = this.torrentProviders()
    log.info(`“${query}” on ${providers.map(p => p.id).join(', ') || 'no providers'}`)
    const settled = await Promise.allSettled(
      providers.map(provider =>
        timed(`search ${provider.id}`, () =>
          provider.search(query, AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]))
        )
      )
    )
    if (signal.aborted) {
      log.debug(`“${query}” was replaced by a newer search`)
      throw signal.reason
    }

    const songs: SearchSong[] = []
    const sections: ProviderSection[] = []
    settled.forEach((outcome, index) => {
      const provider = providers[index]
      const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
      sections.push(section)
      if (outcome.status === 'rejected') {
        section.error = userMessage(outcome.reason, provider.name)
        return
      }
      section.albums = outcome.value.albums.map(album => this.remember(provider, album))
      if (outcome.value.hasMore) section.hasMore = true
      for (const song of outcome.value.songs) {
        const album = this.remember(provider, song.album)
        songs.push({
          id: `${album.id}/${song.key}`,
          key: song.key,
          title: song.title,
          artist: song.artist,
          duration: song.duration,
          album
        })
      }
    })
    log.info(
      `“${query}”: ${songs.length} songs;`,
      sections.map(s => `${s.id} ${s.error ? 'failed' : `${s.albums.length} albums`}`).join(', ')
    )
    return { query, songs, sections }
  }

  /** The Explore page: the enabled charts with their categories, and whether a provider is on to play them. */
  explore(): ExploreOverview {
    return {
      charts: this.chartProviders()
        .filter(p => p.browse && p.categories?.length)
        .map(p => ({
          id: p.id,
          name: p.name,
          categories: p.categories ?? [],
          ...(p.region ? { region: p.region } : {})
        })),
      canPlay: this.torrentProviders().length > 0
    }
  }

  async browse(
    providerId: unknown,
    categoryId: unknown,
    signal: AbortSignal,
    page: unknown = 1,
    region?: unknown
  ): Promise<ProviderSection> {
    const provider = this.chartProviders().find(p => p.id === providerId)
    const browse = provider?.browse
    if (!provider || !browse || !provider.categories?.some(c => c.id === categoryId)) {
      throw new SourceError('That chart can no longer be browsed.')
    }
    const pageNumber = validPage(page)
    let country: string | undefined
    if (region !== undefined && region !== null) {
      country = provider.region ? parseRegion(region, provider.region.worldwide) : undefined
      if (country === undefined) throw new SourceError('That country isn’t available for this chart.')
    }

    const key = `${provider.id}|${categoryId as string}|${pageNumber}|${country ?? 'default'}`
    const cached = this.browsed.get(key)
    if (cached && Date.now() - cached.at < BROWSE_CACHE_MS) {
      log.debug(`browse ${key}: from cache`)
      return cached.section
    }

    const section = await this.section(provider, `browse ${key}`, async () => {
      const results = await browse.call(
        provider,
        categoryId as string,
        AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
        pageNumber,
        country
      )
      if (!this.fillCovers) return results
      const albums = await this.fillCovers(
        results.albums,
        AbortSignal.any([signal, AbortSignal.timeout(COVERS_TIMEOUT_MS)])
      )
      return { ...results, albums }
    })
    // Only good answers are kept: a failure should be tried again next time.
    if (!section.error && section.albums.length > 0) {
      this.browsed.set(key, { at: Date.now(), section })
      if (this.browsed.size > MAX_BROWSE_CACHE) this.browsed.delete(this.browsed.keys().next().value as string)
    }
    return section
  }

  /** Another page of one provider's albums for a search; songs only come with the first page. */
  async searchMore(providerId: unknown, query: unknown, page: unknown, signal: AbortSignal): Promise<ProviderSection> {
    const provider = this.torrentProviders().find(p => p.id === providerId)
    if (!provider) throw new SourceError('That source is no longer available.')
    if (typeof query !== 'string' || !query.trim()) throw new SourceError('Search again to see more.')
    const pageNumber = validPage(page)
    return this.section(provider, `search ${provider.id} “${query.trim()}” page ${pageNumber}`, () =>
      provider.search(query.trim(), AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]), pageNumber)
    )
  }

  /** One provider's albums as a section; a failure becomes the section's error message. */
  private async section(
    provider: MusicProvider,
    what: string,
    load: () => Promise<ProviderResults>
  ): Promise<ProviderSection> {
    const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
    try {
      const results = await timed(what, load)
      section.albums = results.albums.map(album => this.remember(provider, album))
      if (results.hasMore) section.hasMore = true
    } catch (err) {
      section.error = userMessage(err, provider.name)
    }
    return section
  }

  async open(albumId: unknown, signal?: AbortSignal): Promise<Playable> {
    const entry = typeof albumId === 'string' && RESULT_ID.test(albumId) ? this.results.get(albumId) : undefined
    if (!entry) throw new SourceError('That search result has expired — search again.')
    log.info(`opening “${entry.album.title}” from ${entry.provider.id}`)
    try {
      return await timed(`open ${entry.provider.id}`, () => entry.provider.open(entry.album, signal))
    } catch (err) {
      if (err instanceof SourceError) throw err
      throw new SourceError(userMessage(err, entry.provider.name))
    }
  }

  /**
   * Plays a chart entry: searches the torrent providers (one query at a time, stopping at the first that finds a
   * match), then opens the best-ranked releases until one works. Songs also say which track to start with.
   */
  async findRelease(wanted: ChartWanted, signal?: AbortSignal): Promise<Playable> {
    const providers = this.torrentProviders()
    const what = `“${wanted.title}” by ${wanted.artist}`
    if (providers.length === 0) {
      throw new SourceError(`Turn on a provider (Settings → Sources) to play ${what}.`)
    }
    log.info(`finding a release for the chart ${wanted.kind} ${what}`)
    let ranked: Candidate[] = []
    for (const query of chartQueries(wanted)) {
      const found = await this.searchAll(providers, query, signal)
      ranked = rankReleases(wanted, found)
      log.debug(`chart query “${query}”: ${found.length} found, ${ranked.length} match`)
      if (ranked.length > 0 || signal?.aborted) break
    }
    for (const { provider, album } of ranked.slice(0, CHART_ATTEMPTS)) {
      log.info(`trying “${album.title}” from ${provider.id}`)
      try {
        const playable = await provider.open(album, signal)
        return {
          ...playable,
          hints:
            wanted.kind === 'album'
              ? { title: wanted.title, artist: wanted.artist }
              : { title: album.title, artist: album.artist ?? wanted.artist },
          startAt: wanted.kind === 'song' ? { title: wanted.title, artist: wanted.artist } : undefined
        }
      } catch (err) {
        if (signal?.aborted) throw err
        log.warn(`opening “${album.title}” from ${provider.id} failed:`, err)
      }
    }
    throw new SourceError(
      ranked.length > 0
        ? `Found ${what}, but couldn’t open it. Try again later.`
        : `Couldn’t find ${what} on your providers. Turn on more in Settings → Sources, or search for it.`
    )
  }

  /** Every album (and every song's album) the providers find for a query; failing providers are skipped. */
  private async searchAll(providers: MusicProvider[], query: string, signal?: AbortSignal): Promise<Candidate[]> {
    const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    const settled = await Promise.allSettled(
      providers.map(provider => provider.search(query, signal ? AbortSignal.any([signal, timeout]) : timeout))
    )
    const seen = new Set<string>()
    const found: Candidate[] = []
    settled.forEach((outcome, index) => {
      if (outcome.status === 'rejected') return
      const provider = providers[index]
      for (const album of [...outcome.value.albums, ...outcome.value.songs.map(song => song.album)]) {
        const key = `${provider.id}\n${album.ref}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ provider, album })
      }
    })
    return found
  }

  private torrentProviders(): MusicProvider[] {
    return this.providers.filter(p => !p.chart)
  }

  private chartProviders(): MusicProvider[] {
    return this.providers.filter(p => p.chart)
  }

  private remember(provider: MusicProvider, album: ProviderAlbum): SearchAlbum {
    // Stable per provider+locator, so the same album keeps its id across searches.
    const id = `${provider.id}:${createHash('sha256').update(album.ref).digest('hex').slice(0, 24)}`
    this.results.delete(id)
    this.results.set(id, { provider, album })
    if (this.results.size > MAX_REMEMBERED_RESULTS) {
      const oldest = this.results.keys().next().value
      if (oldest !== undefined) this.results.delete(oldest)
    }
    const { ref: _locator, ...shown } = album
    return { id, provider: provider.id, ...shown }
  }
}

/** Runs one provider call, logging how long it took and how it failed. */
async function timed<T>(what: string, call: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const took = () => `${Math.round(performance.now() - started)} ms`
  try {
    const result = await call()
    const { albums, songs } = (result ?? {}) as { albums?: unknown[]; songs?: unknown[] }
    const counts = albums ? `: ${albums.length} albums${songs ? `, ${songs.length} songs` : ''}` : ''
    log.debug(`${what} done in ${took()}${counts}`)
    return result
  } catch (err) {
    log.warn(`${what} failed after ${took()}:`, err)
    throw err
  }
}

function userMessage(err: unknown, name: string): string {
  if (err instanceof TorznabError || err instanceof SourceError) return err.message
  return `Couldn't reach ${name}.`
}

/** Page numbers from the renderer: whole numbers from 1 to MAX_PAGE. */
function validPage(page: unknown): number {
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_PAGE)
    throw new SourceError('That page isn’t available.')
  return page
}
