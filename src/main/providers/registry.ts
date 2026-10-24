import { createHash } from 'node:crypto'
import { SourceError } from '../source.ts'
import type { ExploreSource, ProviderSection, SearchAlbum, SearchResults, SearchSong } from '../../shared/types.ts'
import { TorznabError } from './torznab.ts'
import type { MusicProvider, Playable, ProviderAlbum } from './types.ts'

const PROVIDER_TIMEOUT_MS = 25_000
const MAX_REMEMBERED_RESULTS = 5000
const RESULT_ID = /^[a-z0-9-]{1,40}:[a-f0-9]{24}$/

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
    const settled = await Promise.allSettled(
      this.providers.map(provider =>
        provider.search(query, AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]))
      )
    )
    if (signal.aborted) throw signal.reason

    const songs: SearchSong[] = []
    const sections: ProviderSection[] = []
    settled.forEach((outcome, index) => {
      const provider = this.providers[index]
      const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
      sections.push(section)
      if (outcome.status === 'rejected') {
        section.error = userMessage(outcome.reason, provider.name)
        console.error(`[search] ${provider.id} failed:`, outcome.reason instanceof Error ? outcome.reason.message : outcome.reason)
        return
      }
      section.albums = outcome.value.albums.map(album => this.remember(provider, album))
      for (const song of outcome.value.songs) {
        const album = this.remember(provider, song.album)
        songs.push({ id: `${album.id}/${song.key}`, key: song.key, title: song.title, artist: song.artist, duration: song.duration, album })
      }
    })
    return { query, songs, sections }
  }

  /** Providers that can be browsed, with their categories, for the Explore page. */
  explore(): ExploreSource[] {
    return this.providers
      .filter(p => p.browse && p.categories?.length)
      .map(p => ({ id: p.id, name: p.name, layout: p.layout, categories: p.categories ?? [] }))
  }

  async browse(providerId: unknown, categoryId: unknown, signal: AbortSignal): Promise<ProviderSection> {
    const provider = this.providers.find(p => p.id === providerId)
    if (!provider?.browse || !provider.categories?.some(c => c.id === categoryId)) {
      throw new SourceError('That source can no longer be browsed.')
    }
    const section: ProviderSection = { id: provider.id, name: provider.name, layout: provider.layout, albums: [] }
    try {
      const results = await provider.browse(categoryId as string, AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]))
      section.albums = results.albums.map(album => this.remember(provider, album))
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
