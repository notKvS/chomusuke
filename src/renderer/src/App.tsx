import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchSong, TorrentStats, Track } from '../../shared/types'
import { Icon } from './components/Icon'
import { Chomu } from './components/mascot/Chomu'
import { Particles } from './components/mascot/Particles'
import { Splash } from './components/mascot/Splash'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { type SettingsSection, sidebarKey } from './navigation'
import { PageContent } from './PageContent'
import { queueEdges } from './queue'
import { looksLikeSource } from './source'
import { useAppearance } from './theme/useAppearance'
import { useAlbumLoader, useLoadedAlbums } from './useAlbumLoader'
import { useNavigation } from './useNavigation'
import { usePlayer } from './usePlayer'
import { usePlaylists } from './usePlaylists'
import { useQueue } from './useQueue'
import { useRatings } from './useRatings'
import { useSearches } from './useSearches'
import { useSidebarCollapsed } from './useSidebarCollapsed'
import { useToast } from './useToast'

/** The app shell: wires the hooks to the top bar, sidebar, page and player bar. */
export function App() {
  const [stats, setStats] = useState<Record<string, TorrentStats>>({})
  const [toast, setToast] = useToast()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const looks = useAppearance()
  // Decided once at launch: turning the setting on later shouldn't replay the splash.
  const [showSplash] = useState(looks.appearance.splash)
  const ratings = useRatings()
  const { ratingOf } = ratings
  // Disliked songs are skipped when an album plays on (the track id starts with its torrent's info hash).
  const isDisliked = useCallback((track: Track) => ratingOf(track.id.slice(0, 40), track).rating === -1, [ratingOf])
  const playlists = usePlaylists()
  // The player asks this to go past the end (or start) of the current album; filled in once the queue exists.
  const edgeRef = useRef<(direction: 1 | -1) => boolean>(() => false)
  const onEdge = useCallback((direction: 1 | -1) => edgeRef.current(direction), [])
  const player = usePlayer(setToast, isDisliked, onEdge)
  const { playAt, toggle } = player

  const nav = useNavigation()
  const { view, goTo } = nav
  const loaded = useLoadedAlbums()
  const queue = useQueue({ playAt, addAlbum: loaded.addAlbum, setToast })
  edgeRef.current = queue.step
  const loader = useAlbumLoader({ loaded, nav, play: queue.playAlbumAt, setToast })
  const { loadSource, openSearchAlbum, hashFor } = loader
  const { searches, runSearch } = useSearches({ page: nav.page, nav })

  useEffect(() => window.chomusuke.onStats(list => setStats(Object.fromEntries(list.map(s => [s.infoHash, s])))), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.code !== 'Space' || target.closest('input, button, textarea')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const submitTopBar = useCallback(
    (input: string) => (looksLikeSource(input) ? loadSource(input) : void runSearch(input)),
    [loadSource, runSearch]
  )

  const playSong = useCallback(
    (song: SearchSong) => {
      const hash = hashFor(song.album.id)
      if (hash && player.state.album?.infoHash === hash && player.track?.key === song.key) return toggle()
      openSearchAlbum(song.album, { key: song.key })
    },
    [hashFor, openSearchAlbum, player.state.album, player.track, toggle]
  )

  const isSongPlaying = (song: SearchSong): boolean =>
    player.track?.key === song.key &&
    player.state.album?.infoHash !== undefined &&
    hashFor(song.album.id) === player.state.album.infoHash

  const goHome = useCallback(() => goTo({ kind: 'home' }), [goTo])
  const goSettings = useCallback(
    (section: SettingsSection = 'appearance') => goTo({ kind: 'settings', section }),
    [goTo]
  )
  const goSources = useCallback(() => goSettings('sources'), [goSettings])
  const goPlaylist = useCallback((id: string) => goTo({ kind: 'playlist', id }), [goTo])
  const createPlaylist = useCallback(
    async (name: string) => {
      const result = await playlists.create(name)
      if (result.id) goPlaylist(result.id)
      return result.error
    },
    [playlists, goPlaylist]
  )

  const playingHash = player.state.album?.infoHash ?? null

  return (
    <div className={`app ${player.track ? 'has-player' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      {looks.appearance.particles !== 'off' && (
        <Particles kind={looks.appearance.particles} count={looks.appearance.particleCount} />
      )}
      <TopBar
        onSubmit={submitTopBar}
        onHome={goHome}
        playing={player.state.isPlaying}
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        onBack={nav.goBack}
        onForward={nav.goForward}
      />
      <Sidebar
        active={sidebarKey(view)}
        albums={loaded.albums}
        playingAlbum={playingHash}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onHome={goHome}
        onExplore={() => goTo({ kind: 'explore' })}
        onSettings={() => goSettings()}
        onLiked={() => goTo({ kind: 'liked' })}
        likedCount={ratings.songs.filter(song => song.rating === 1).length}
        onSaved={() => goTo({ kind: 'saved' })}
        playlists={playlists.playlists}
        onOpenPlaylist={goPlaylist}
        onCreatePlaylist={createPlaylist}
        onOpenAlbum={loader.openAlbum}
        onOpenFile={loader.openFile}
      />
      <main className="content" ref={nav.contentRef} onScroll={e => nav.rememberScroll(e.currentTarget.scrollTop)}>
        <PageContent
          view={view}
          albums={loaded.albums}
          searches={searches}
          stats={stats}
          player={player}
          queue={queue.queue}
          ratings={ratings}
          playlists={playlists}
          looks={looks}
          onOpenFeatured={(f, autoplay) =>
            loadSource(f.source, { title: f.title, artist: f.artist }, f.artwork, autoplay)
          }
          onOpenAlbum={loader.openAlbum}
          onOpenSearchAlbum={openSearchAlbum}
          onOpenLibraryAlbum={loader.openLibraryAlbum}
          onPlaySong={playSong}
          isSongPlaying={isSongPlaying}
          onRetrySearch={query => void runSearch(query, false)}
          onPlayAlbumAt={queue.playAlbumAt}
          onStartQueue={queue.startQueue}
          onSettings={goSettings}
          onManageSources={goSources}
          onHome={goHome}
        />
      </main>
      <PlayerBar
        player={player}
        stats={playingHash ? stats[playingHash] : undefined}
        onOpenAlbum={() => playingHash && loader.openAlbum(playingHash)}
        ratings={ratings}
        playlists={playlists}
        queue={queue.queue ? { label: queue.queue.label, ...queueEdges(queue.queue) } : undefined}
      />
      {toast && (
        <div className="toast" role="alert">
          <Chomu mood="sad" size={44} headOnly />
          <span>{toast}</span>
          <button type="button" className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {showSplash && <Splash />}
    </div>
  )
}
