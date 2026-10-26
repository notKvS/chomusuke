import type { Album } from '../../../shared/types'
import { Cover } from './Cover'
import { Icon } from './Icon'

interface Props {
  active: 'home' | string
  albums: Album[]
  playingAlbum: string | null
  hasSearch: boolean
  onHome: () => void
  onSearch: () => void
  onSources: () => void
  onExplore: () => void
  onAppearance: () => void
  onOpenAlbum: (infoHash: string) => void
  onOpenFile: () => void
}

export function Sidebar({
  active,
  albums,
  playingAlbum,
  hasSearch,
  onHome,
  onSearch,
  onSources,
  onExplore,
  onAppearance,
  onOpenAlbum,
  onOpenFile
}: Props) {
  return (
    <nav className="sidebar">
      <button type="button" className={`nav-item ${active === 'home' ? 'is-active' : ''}`} onClick={onHome}>
        <Icon name="home" />
        <span className="nav-item__label">Home</span>
      </button>
      <button type="button" className={`nav-item ${active === 'explore' ? 'is-active' : ''}`} onClick={onExplore}>
        <Icon name="explore" />
        <span className="nav-item__label">Explore</span>
      </button>
      <button
        type="button"
        className={`nav-item ${active === 'search' ? 'is-active' : ''}`}
        onClick={onSearch}
        disabled={!hasSearch}
        title={hasSearch ? 'Back to your last search' : 'Search from the bar above'}
      >
        <Icon name="search" />
        <span className="nav-item__label">Search</span>
      </button>
      <button
        type="button"
        className={`nav-item ${playingAlbum && active === playingAlbum ? 'is-active' : ''}`}
        onClick={() => playingAlbum && onOpenAlbum(playingAlbum)}
        disabled={!playingAlbum}
      >
        <Icon name="nowPlaying" />
        <span className="nav-item__label">Now playing</span>
      </button>
      <button type="button" className={`nav-item ${active === 'sources' ? 'is-active' : ''}`} onClick={onSources}>
        <Icon name="tune" />
        <span className="nav-item__label">Sources</span>
      </button>
      <button type="button" className={`nav-item ${active === 'appearance' ? 'is-active' : ''}`} onClick={onAppearance}>
        <Icon name="palette" />
        <span className="nav-item__label">Appearance</span>
      </button>

      <hr className="sidebar__divider" />

      <button type="button" className="pill-button" onClick={onOpenFile}>
        <Icon name="add" size={20} />
        <span>Open .torrent file</span>
      </button>

      {albums.length > 0 && (
        <ul className="sidebar__albums" aria-label="Loaded this session">
          {albums.map(album => (
            <li key={album.infoHash}>
              <button
                type="button"
                className={`sidebar-album ${active === album.infoHash ? 'is-active' : ''}`}
                onClick={() => onOpenAlbum(album.infoHash)}
                title={album.title}
              >
                <Cover src={album.coverUrl} size={40} />
                <span className="sidebar-album__text">
                  <span className="sidebar-album__title">{album.title}</span>
                  <span className="sidebar-album__sub">
                    {playingAlbum === album.infoHash && (
                      <Icon name="volume" size={12} className="sidebar-album__playing" />
                    )}
                    {album.artist ?? 'Torrent'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
