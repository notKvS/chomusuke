import type { ProviderSection, SearchAlbum, SearchResults, SearchSong } from '../../../shared/types'
import { formatBytes, formatTime, plural } from '../format'
import { Card } from './Card'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'

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
  onManageSources: () => void
}

const albumSubtitle = (album: SearchAlbum): string =>
  ['Album', album.artist ?? 'Unknown artist', album.year].filter(Boolean).join(' • ')

const isEmpty = (results: SearchResults): boolean =>
  results.songs.length === 0 && results.sections.every(section => section.albums.length === 0)

export function SearchView({ search, isPlaying, onPlaySong, onOpenAlbum, onRetry, onManageSources }: Props) {
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
            <button type="button" className="solid-button" onClick={onManageSources}>
              Manage sources
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
          <Section key={section.id} section={section} onOpenAlbum={onOpenAlbum} />
        ))}
    </div>
  )
}

function Section({ section, onOpenAlbum }: { section: ProviderSection; onOpenAlbum: Props['onOpenAlbum'] }) {
  if (!section.error && section.albums.length === 0) return null
  return (
    <section className="shelf">
      <p className="shelf__eyebrow">{section.layout === 'list' ? 'Torrents' : 'Albums'}</p>
      <h2 className="shelf__title">{section.name}</h2>
      <SectionBody section={section} onOpenAlbum={onOpenAlbum} />
    </section>
  )
}

/** A provider's albums: artwork cards, or torrent-release rows. Shared by Search and Explore. */
export function SectionBody({ section, onOpenAlbum }: { section: ProviderSection; onOpenAlbum: Props['onOpenAlbum'] }) {
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
          {section.albums.map(album => (
            <Card
              key={album.id}
              artwork={album.artwork}
              title={album.title}
              subtitle={albumSubtitle(album)}
              badge={album.license}
              onOpen={autoplay => onOpenAlbum(album, autoplay)}
            />
          ))}
        </div>
      ) : (
        <ol className="song-list">
          {section.albums.map(album => (
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
    </>
  )
}
