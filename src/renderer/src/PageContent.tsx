import type { Album, SearchAlbum, SearchSong, SongRef, TorrentStats } from '../../shared/types'
import { AlbumError, AlbumLoading, AlbumView } from './components/AlbumView'
import { ExploreView } from './components/ExploreView'
import { Home } from './components/Home'
import { LikedView } from './components/LikedView'
import { PlaylistView } from './components/PlaylistView'
import { SavedAlbumsView } from './components/SavedAlbumsView'
import { type SearchState, SearchView } from './components/SearchView'
import { SettingsView } from './components/settings/SettingsView'
import type { FeaturedAlbum } from './featured'
import type { SettingsSection, View } from './navigation'
import type { Queue } from './queue'
import type { AppearanceControls } from './theme/useAppearance'
import type { Autoplay } from './useAlbumLoader'
import type { Player } from './usePlayer'
import type { Playlists } from './usePlaylists'
import type { Ratings } from './useRatings'

interface Props {
  view: View
  albums: Album[]
  searches: Record<string, SearchState>
  stats: Record<string, TorrentStats>
  player: Player
  queue: Queue | null
  ratings: Ratings
  playlists: Playlists
  looks: AppearanceControls
  onOpenFeatured: (album: FeaturedAlbum, autoplay: boolean) => void
  onOpenAlbum: (infoHash: string, autoplay?: boolean) => void
  onOpenSearchAlbum: (album: SearchAlbum, autoplay: Autoplay) => void
  onOpenLibraryAlbum: (infoHash: string) => void
  onPlaySong: (song: SearchSong) => void
  isSongPlaying: (song: SearchSong) => boolean
  onRetrySearch: (query: string) => void
  onPlayAlbumAt: (album: Album, index: number) => void
  onStartQueue: (
    label: string,
    items: SongRef[],
    start: number,
    options?: { shuffle?: boolean; playlistId?: string }
  ) => void
  onSettings: (section: SettingsSection) => void
  onManageSources: () => void
  onHome: () => void
}

/** The page (or loading/error overlay) shown in the content area. */
export function PageContent(props: Props) {
  const { view, player, ratings, playlists } = props
  switch (view.kind) {
    case 'home':
      return <Home albums={props.albums} onOpenFeatured={props.onOpenFeatured} onOpenAlbum={props.onOpenAlbum} />
    case 'search':
      return (
        <SearchView
          search={props.searches[view.query] ?? { query: view.query, status: 'loading' }}
          isPlaying={props.isSongPlaying}
          onPlaySong={props.onPlaySong}
          onOpenAlbum={props.onOpenSearchAlbum}
          onRetry={() => props.onRetrySearch(view.query)}
          onManageSources={props.onManageSources}
        />
      )
    case 'explore':
      return <ExploreView onOpenAlbum={props.onOpenSearchAlbum} onManageSources={props.onManageSources} />
    case 'settings':
      return (
        <SettingsView
          section={view.section}
          onSection={props.onSettings}
          looks={props.looks}
          ratings={ratings}
          onOpenAlbum={props.onOpenLibraryAlbum}
        />
      )
    case 'liked':
      return (
        <LikedView
          ratings={ratings}
          playlists={playlists}
          onPlay={(songs, index) => props.onStartQueue('Liked songs', songs, index)}
        />
      )
    case 'playlist': {
      const playlist = playlists.playlists.find(p => p.id === view.id)
      const { queue } = props
      return playlist ? (
        <PlaylistView
          playlist={playlist}
          playlists={playlists}
          currentSongId={
            queue?.playlistId === playlist.id && player.track ? (queue.items[queue.position]?.id ?? null) : null
          }
          onPlay={(index, shuffle) =>
            props.onStartQueue(playlist.name, playlist.songs, index, { shuffle, playlistId: playlist.id })
          }
          onDeleted={props.onHome}
        />
      ) : (
        <div className="page">
          <p className="sources__lead">That playlist no longer exists.</p>
        </div>
      )
    }
    case 'saved':
      return <SavedAlbumsView onOpen={props.onOpenLibraryAlbum} />
    case 'loading':
      return <AlbumLoading title={view.title} artist={view.artist} artwork={view.artwork} />
    case 'error':
      return <AlbumError message={view.message} onRetry={view.retry} onHome={props.onHome} />
    case 'album': {
      const album = props.albums.find(a => a.infoHash === view.infoHash)
      return album ? (
        <AlbumView
          album={album}
          stats={props.stats[album.infoHash]}
          durations={player.durations}
          currentTrackId={player.track?.id ?? null}
          isPlaying={player.state.isPlaying}
          onPlay={index => props.onPlayAlbumAt(album, index)}
          onToggle={player.toggle}
          ratings={ratings}
          playlists={playlists}
        />
      ) : null
    }
  }
}
