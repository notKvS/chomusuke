import { type FormEvent, useState } from 'react'
import type { Album, Playlist } from '../../../shared/types'
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
  onLibrary: () => void
  onLiked: () => void
  playlists: Playlist[]
  onOpenPlaylist: (id: string) => void
  /** Creates a playlist and opens it; returns an error message, if any. */
  onCreatePlaylist: (name: string) => Promise<string | undefined>
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
  onLibrary,
  onLiked,
  playlists,
  onOpenPlaylist,
  onCreatePlaylist,
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
      <button type="button" className={`nav-item ${active === 'liked' ? 'is-active' : ''}`} onClick={onLiked}>
        <Icon name="thumbUp" />
        <span className="nav-item__label">Liked songs</span>
      </button>
      <button type="button" className={`nav-item ${active === 'library' ? 'is-active' : ''}`} onClick={onLibrary}>
        <Icon name="library" />
        <span className="nav-item__label">Library</span>
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

      <PlaylistsSection playlists={playlists} active={active} onOpen={onOpenPlaylist} onCreate={onCreatePlaylist} />

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

function PlaylistsSection({
  playlists,
  active,
  onOpen,
  onCreate
}: {
  playlists: Playlist[]
  active: string
  onOpen: (id: string) => void
  onCreate: (name: string) => Promise<string | undefined>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setCreating(false)
    const problem = await onCreate(name)
    setError(problem)
    if (!problem) {
      setName('')
      setCreating(false)
    }
  }

  return (
    <div className="sidebar-playlists">
      <div className="sidebar-playlists__head">
        <span>Playlists</span>
        <button
          type="button"
          className="icon-button"
          aria-label="New playlist"
          title="New playlist"
          onClick={() => setCreating(v => !v)}
        >
          <Icon name="add" size={20} />
        </button>
      </div>
      {creating && (
        <form className="sidebar-playlists__new" onSubmit={submit}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Playlist name"
            maxLength={100}
            aria-label="New playlist name"
            // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to create a playlist
            autoFocus
            onKeyDown={e => e.key === 'Escape' && setCreating(false)}
          />
          {error && <small>{error}</small>}
        </form>
      )}
      {playlists.map(playlist => (
        <button
          key={playlist.id}
          type="button"
          className={`sidebar-playlist ${active === `playlist:${playlist.id}` ? 'is-active' : ''}`}
          onClick={() => onOpen(playlist.id)}
          title={playlist.name}
        >
          <Icon name="queueMusic" size={20} />
          <span className="sidebar-playlist__name">{playlist.name}</span>
          <span className="sidebar-playlist__count">{playlist.songs.length}</span>
        </button>
      ))}
    </div>
  )
}
