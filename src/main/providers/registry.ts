import { createHash } from 'node:crypto'
import type { ExploreSource, ProviderSection, SearchAlbum, SearchResults, SearchSong } from '../../shared/types.ts'
import { SourceError } from '../source.ts'
import { type ChartWanted, chartQueries, rankReleases } from './chart-match.ts'
import { TorznabError } from './torznab.ts'
import type { MusicProvider, Playable, ProviderAlbum, ProviderResults } from './types.ts'

const PROVIDER_TIMEOUT_MS = 25_000
const MAX_REMEMBERED_RESULTS = 5000
const RESULT_ID = /^[a-z0-9-]{1,40}:[a-f0-9]{24}$/
/** Best-ranked releases tried, in order, when opening a chart entry (one may fail to download). */
const CHART_ATTEMPTS = 3
/** How far "Load more" can go for one search or category. */
export const MAX_PAGE = 20

type Candidate = { provider: MusicProvider; album: ProviderAlbum }

/**
 * Fans a query out to every enabled provider and remembers which provider/locator each result came from,
 * so the renderer can open a result by opaque id without ever handling URLs, magnets or API keys.
 */
export class ProviderRegistry {
  private providers: MusicProvider[] = []
  private readonly results = new Map<string, { provider: MusicProvider; album: ProviderAlbum }>()

  setProviders(providers: MusicProvider[]): void {
    this.providers = providers
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
    const settled = await Promise.allSettled(
      providers.map(provider =>
        provider.search(query, AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]))
      )
    )
    if (signal.aborted) throw signal.reason

    const songs: SearchSong[] = []
    const sections: ProviderSection[] = []
    settled.forEach((outcome, index) => {
      const provider = providers[index]
      const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
      sections.push(section)
      if (outcome.status === 'rejected') {
        section.error = userMessage(outcome.reason, provider.name)
        console.error(
          `[search] ${provider.id} failed:`,
          outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
        )
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
    return { query, songs, sections }
  }

  /** Providers that can be browsed, with their categories, for the Explore page; charts first. */
  explore(): ExploreSource[] {
    return this.providers
      .filter(p => p.browse && p.categories?.length)
      .sort((a, b) => Number(Boolean(b.chart)) - Number(Boolean(a.chart)))
      .map(p => ({
        id: p.id,
        name: p.name,
        layout: p.layout,
        categories: p.categories ?? [],
        ...(p.chart ? { chart: true } : {})
      }))
  }

  async browse(
    providerId: unknown,
    categoryId: unknown,
    signal: AbortSignal,
    page: unknown = 1
  ): Promise<ProviderSection> {
    const provider = this.providers.find(p => p.id === providerId)
    const browse = provider?.browse
    if (!provider || !browse || !provider.categories?.some(c => c.id === categoryId)) {
      throw new SourceError('That source can no longer be browsed.')
    }
    const pageNumber = validPage(page)
    return this.section(provider, () =>
      browse.call(
        provider,
        categoryId as string,
        AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
        pageNumber
      )
    )
  }

  /** Another page of one provider's albums for a search; songs only come with the first page. */
  async searchMore(providerId: unknown, query: unknown, page: unknown, signal: AbortSignal): Promise<ProviderSection> {
    const provider = this.torrentProviders().find(p => p.id === providerId)
    if (!provider) throw new SourceError('That source is no longer available.')
    if (typeof query !== 'string' || !query.trim()) throw new SourceError('Search again to see more.')
    const pageNumber = validPage(page)
    return this.section(provider, () =>
      provider.search(query.trim(), AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]), pageNumber)
    )
  }

  /** One provider's albums as a section; a failure becomes the section's error message. */
  private async section(provider: MusicProvider, load: () => Promise<ProviderResults>): Promise<ProviderSection> {
    const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
    try {
      const results = await load()
      section.albums = results.albums.map(album => this.remember(provider, album))
      if (results.hasMore) section.hasMore = true
    } catch (err) {
      console.error(`[explore] ${provider.id} failed:`, err instanceof Error ? err.message : err)
      section.error = userMessage(err, provider.name)
    }
    return section
  }

  async open(albumId: unknown, signal?: AbortSignal): Promise<Playable> {
    const entry = typeof albumId === 'string' && RESULT_ID.test(albumId) ? this.results.get(albumId) : undefined
    if (!entry) throw new SourceError('That search result has expired — search again.')
    try {
      return await entry.provider.open(entry.album, signal)
    } catch (err) {
      if (err instanceof SourceError) throw err
      console.error(`[search] opening a ${entry.provider.id} result failed:`, err instanceof Error ? err.message : err)
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
      throw new SourceError(`Turn on a torrent source (Settings → Sources) to play ${what}.`)
    }
    let ranked: Candidate[] = []
    for (const query of chartQueries(wanted)) {
      const found = await this.searchAll(providers, query, signal)
      ranked = rankReleases(wanted, found)
      if (ranked.length > 0 || signal?.aborted) break
    }
    for (const { provider, album } of ranked.slice(0, CHART_ATTEMPTS)) {
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
        console.error(`[charts] opening a ${provider.id} release failed:`, err instanceof Error ? err.message : err)
      }
    }
    throw new SourceError(
      ranked.length > 0
        ? `Found ${what}, but couldn’t open it. Try again later.`
        : `Couldn’t find ${what} on your torrent sources. Turn on more sources in Settings → Sources, or search for it.`
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
