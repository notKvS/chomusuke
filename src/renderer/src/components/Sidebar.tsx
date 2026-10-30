import { type FormEvent, useState } from 'react'
import type { Album, Playlist } from '../../../shared/types'
import { Cover } from './Cover'
import { Icon, type IconName } from './Icon'
import './Sidebar.css'

interface Props {
  active: 'home' | string
  albums: Album[]
  playingAlbum: string | null
  /** Icons only, to give the page more room. */
  collapsed: boolean
  onToggleCollapsed: () => void
  onHome: () => void
  onExplore: () => void
  onSettings: () => void
  onLiked: () => void
  likedCount: number
  onSaved: () => void
  playlists: Playlist[]
  onOpenPlaylist: (id: string) => void
  /** Creates a playlist and opens it; returns an error message, if any. */
  onCreatePlaylist: (name: string) => Promise<string | undefined>
  onOpenAlbum: (infoHash: string) => void
  onOpenFile: () => void
}

/**
 * Main navigation, playlists, and the albums loaded this session. Collapsed, it shows icons only and names move into
 * tooltips; the collapse animation itself is run by the caller (see useSidebarCollapsed).
 */
export function Sidebar({
  active,
  albums,
  playingAlbum,
  collapsed,
  onToggleCollapsed,
  onHome,
  onExplore,
  onSettings,
  onLiked,
  likedCount,
  onSaved,
  playlists,
  onOpenPlaylist,
  onCreatePlaylist,
  onOpenAlbum,
  onOpenFile
}: Props) {
  return (
    <nav className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Main">
      <div className="sidebar__scroll">
        <NavItem icon="home" label="Home" active={active === 'home'} collapsed={collapsed} onClick={onHome} />
        <NavItem
          icon="explore"
          label="Explore"
          active={active === 'explore'}
          collapsed={collapsed}
          onClick={onExplore}
        />
        <NavItem
          icon="nowPlaying"
          label="Now playing"
          active={playingAlbum !== null && active === playingAlbum}
          collapsed={collapsed}
          onClick={() => playingAlbum && onOpenAlbum(playingAlbum)}
          disabled={!playingAlbum}
        />
        <NavItem
          icon="settings"
          label="Settings"
          active={active === 'settings'}
          collapsed={collapsed}
          onClick={onSettings}
        />

        <hr className="sidebar__divider" />

        <PlaylistsSection
          playlists={playlists}
          active={active}
          collapsed={collapsed}
          likedCount={likedCount}
          onLiked={onLiked}
          onSaved={onSaved}
          onOpen={onOpenPlaylist}
          onCreate={onCreatePlaylist}
        />

        <button type="button" className="pill-button" onClick={onOpenFile} title="Open .torrent file">
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
      </div>

      <button
        type="button"
        className="nav-item sidebar__toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : undefined}
      >
        <Icon name={collapsed ? 'menu' : 'menuOpen'} />
        <span className="nav-item__label">Collapse</span>
      </button>
    </nav>
  )
}

function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  disabled,
  title
}: {
  icon: IconName
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? (collapsed ? label : undefined)}
      aria-label={collapsed ? label : undefined}
    >
      <Icon name={icon} />
      <span className="nav-item__label">{label}</span>
    </button>
  )
}

function PlaylistsSection({
  playlists,
  active,
  collapsed,
  likedCount,
  onLiked,
  onSaved,
  onOpen,
  onCreate
}: {
  playlists: Playlist[]
  active: string
  collapsed: boolean
  likedCount: number
  onLiked: () => void
  onSaved: () => void
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
      {!collapsed && (
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
      )}
      {creating && !collapsed && (
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
      <PlaylistLink
        icon="thumbUp"
        name="Liked songs"
        count={likedCount}
        active={active === 'liked'}
        onClick={onLiked}
      />
      <PlaylistLink icon="library" name="Saved albums" active={active === 'saved'} onClick={onSaved} />
      {playlists.map(playlist => (
        <PlaylistLink
          key={playlist.id}
          icon="queueMusic"
          name={playlist.name}
          count={playlist.songs.length}
          active={active === `playlist:${playlist.id}`}
          onClick={() => onOpen(playlist.id)}
        />
      ))}
    </div>
  )
}

function PlaylistLink({
  icon,
  name,
  count,
  active,
  onClick
}: {
  icon: IconName
  name: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`sidebar-playlist ${active ? 'is-active' : ''}`}
      onClick={onClick}
      title={name}
      aria-label={name}
    >
      <Icon name={icon} size={20} />
      <span className="sidebar-playlist__name">{name}</span>
      {count !== undefined && <span className="sidebar-playlist__count">{count}</span>}
    </button>
  )
}
