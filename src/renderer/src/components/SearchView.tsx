import { useEffect, useRef, useState } from 'react'
import type { BrowseResponse, ProviderSection, SearchAlbum, SearchResults, SearchSong } from '../../../shared/types'
import { formatBytes, formatTime, plural } from '../format'
import { ArtistLink } from './ArtistLink'
import { Card } from './Card'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'
import './AlbumView.css'
import './SearchView.css'

export type SearchState =
  | { query: string; status: 'loading' }
  | { query: string; status: 'done'; results: SearchResults }
  | { query: string; status: 'error'; error: string }

interface Props {
  search: SearchState
  isPlaying: (song: SearchSong) => boolean
  onPlaySong: (song: SearchSong) => void
  onOpenAlbum: (album: SearchAlbum, autoplay: boolean) => void
  onRetry: () => void
  onManagePlugins: () => void
}

const albumSubtitle = (album: SearchAlbum): string =>
  [album.chart === 'song' ? 'Song' : 'Album', album.artist ?? 'Unknown artist', album.year].filter(Boolean).join(' • ')

const isEmpty = (results: SearchResults): boolean =>
  results.songs.length === 0 && results.sections.every(section => section.albums.length === 0)

/**
 * Search results: matching songs first, then one section of albums per source (cards or a release list, as the
 * source prefers). Shows a sticker for errors, no sources and no results.
 */
export function SearchView({ search, isPlaying, onPlaySong, onOpenAlbum, onRetry, onManagePlugins }: Props) {
  const results = search.status === 'done' ? search.results : null
  const noSources = results !== null && results.sections.length === 0

  return (
    <div className="page search">
      <h1 className="search__title">Results for “{search.query}”</h1>

      {search.status === 'loading' && (
        <div className="song-list" aria-busy="true">
          {['a', 'b', 'c', 'd', 'e'].map(key => (
            <div key={key} className="skeleton-row" />
          ))}
        </div>
      )}

      {search.status === 'error' && (
        <div className="search__message">
          <Sticker scene="search-error">
            <p>{search.error}</p>
            <button type="button" className="solid-button" onClick={onRetry}>
              Try again
            </button>
          </Sticker>
        </div>
      )}

      {noSources && (
        <div className="search__message">
          <Sticker scene="no-sources">
            <button type="button" className="solid-button" onClick={onManagePlugins}>
              Manage plugins
            </button>
          </Sticker>
        </div>
      )}

      {results && !noSources && isEmpty(results) && !results.sections.some(s => s.error) && (
        <div className="search__message">
          <Sticker scene="search-empty">
            <p>Try fewer words, or just the artist's name.</p>
          </Sticker>
        </div>
      )}

      {results && results.songs.length > 0 && (
        <section className="shelf">
          <h2 className="shelf__title">Songs</h2>
          <ol className="song-list">
            {results.songs.map(song => {
              const playing = isPlaying(song)
              return (
                <li key={song.id}>
                  <button
                    type="button"
                    className={`song-row ${playing ? 'is-current' : ''}`}
                    onClick={() => onPlaySong(song)}
                    title={`Play ${song.title}`}
                  >
                    <span className="song-row__art">
                      <Cover src={song.album.artwork} size={48} />
                      <span className="song-row__play">
                        <Icon name={playing ? 'nowPlaying' : 'play'} />
                      </span>
                    </span>
                    <span className="song-row__text">
                      <span className="song-row__title">{song.title}</span>
                      <span className="song-row__sub">
                        {['Song', song.artist, song.album.title].filter(Boolean).join(' • ')}
                      </span>
                    </span>
                    {song.album.license && <span className="track__format">{song.album.license}</span>}
                    <span className="track__duration">{song.duration ? formatTime(song.duration) : ''}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* Torrent indexers you configured come first; the Internet Archive's album grid follows. */}
      {results?.sections
        .filter(section => section.layout === 'list')
        .concat(results.sections.filter(section => section.layout !== 'list'))
        .map(section => (
          <Section key={section.id} section={section} query={search.query} onOpenAlbum={onOpenAlbum} />
        ))}
    </div>
  )
}

function Section({
  section,
  query,
  onOpenAlbum
}: {
  section: ProviderSection
  query: string
  onOpenAlbum: Props['onOpenAlbum']
}) {
  if (!section.error && section.albums.length === 0) return null
  return (
    <section className="shelf">
      <p className="shelf__eyebrow">{section.layout === 'list' ? 'Torrents' : 'Albums'}</p>
      <h2 className="shelf__title">{section.name}</h2>
      <SectionBody
        section={section}
        onOpenAlbum={onOpenAlbum}
        fetchPage={page => window.chomusuke.searchMore(section.id, query, page)}
      />
    </section>
  )
}

/**
 * A section's albums plus any later pages loaded with "Load more". Starts over whenever a new first page arrives
 * (another search, category or source).
 */
function usePages(section: ProviderSection, fetchPage?: (page: number) => Promise<BrowseResponse>) {
  const [more, setMore] = useState<{ albums: SearchAlbum[]; page: number; hasMore: boolean }>({
    albums: [],
    page: 1,
    hasMore: Boolean(section.hasMore)
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current++
    setMore({ albums: [], page: 1, hasMore: Boolean(section.hasMore) })
    setLoading(false)
    setError(null)
  }, [section])

  const loadMore = async () => {
    if (!fetchPage || loading) return
    const current = generation.current
    setLoading(true)
    setError(null)
    const response = await fetchPage(more.page + 1)
    if (current !== generation.current) return
    setLoading(false)
    if (!response.ok || response.section.error) {
      setError(response.ok ? (response.section.error ?? null) : response.error)
      return
    }
    const added = response.section.albums
    setMore(prev => {
      const seen = new Set([...section.albums, ...prev.albums].map(album => album.id))
      const fresh = added.filter(album => !seen.has(album.id))
      return {
        albums: [...prev.albums, ...fresh],
        page: prev.page + 1,
        hasMore: Boolean(response.section.hasMore) && fresh.length > 0
      }
    })
  }

  return {
    albums: more.albums.length > 0 ? [...section.albums, ...more.albums] : section.albums,
    canLoadMore: fetchPage !== undefined && more.hasMore,
    loading,
    error,
    loadMore
  }
}

/** "Album • Artist • 2024", with the artist searchable. */
function AlbumSubtitle({ album }: { album: SearchAlbum }) {
  return (
    <>
      {album.chart === 'song' ? 'Song' : 'Album'} •{' '}
      {album.artist ? <ArtistLink name={album.artist} /> : 'Unknown artist'}
      {album.year && ` • ${album.year}`}
    </>
  )
}

/** A provider's albums: artwork cards, or torrent-release rows. Shared by Search and Explore. */
export function SectionBody({
  section,
  onOpenAlbum,
  fetchPage
}: {
  section: ProviderSection
  onOpenAlbum: Props['onOpenAlbum']
  /** Loads page 2, 3… when the section has more */
  fetchPage?: (page: number) => Promise<BrowseResponse>
}) {
  const pages = usePages(section, fetchPage)
  return (
    <>
      {section.error && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {section.error}
        </p>
      )}
      {section.layout === 'cards' ? (
        <div className="shelf__grid">
          {pages.albums.map((album, index) => (
            <Card
              key={album.id}
              artwork={album.artwork}
              title={album.title}
              subtitle={<AlbumSubtitle album={album} />}
              subtitleText={albumSubtitle(album)}
              badge={album.license ?? (album.chart ? `#${index + 1}` : undefined)}
              tags={album.tags}
              onOpen={autoplay => onOpenAlbum(album, autoplay)}
            />
          ))}
        </div>
      ) : (
        <ol className="song-list">
          {pages.albums.map(album => (
            <li key={album.id} className="release">
              <button
                type="button"
                className="song-row release-row"
                onClick={() => onOpenAlbum(album, false)}
                title={album.title}
              >
                <span className="release-row__icon">
                  <Icon name="download" />
                </span>
                <span className="song-row__text">
                  <span className="song-row__title">{album.title}</span>
                  <span className="song-row__sub">
                    {[
                      album.seeders !== undefined && plural(album.seeders, 'seeder'),
                      album.size !== undefined && formatBytes(album.size),
                      album.year
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                </span>
                <span className="release-row__tags">
                  {album.tags?.map(tag => (
                    <span key={tag} className="track__format">
                      {tag}
                    </span>
                  ))}
                </span>
              </button>
              <button
                type="button"
                className="icon-button release__play"
                onClick={() => onOpenAlbum(album, true)}
                aria-label={`Play ${album.title}`}
              >
                <Icon name="play" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {(pages.canLoadMore || pages.error) && (
        <div className="load-more">
          {pages.error && (
            <p className="section-error">
              <Icon name="error" size={18} />
              {pages.error}
            </p>
          )}
          {pages.canLoadMore && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => void pages.loadMore()}
              disabled={pages.loading}
              aria-busy={pages.loading}
            >
              {pages.loading ? 'Loading…' : pages.error ? 'Try again' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </>
  )
}
