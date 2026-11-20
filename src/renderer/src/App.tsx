import { useCallback, useEffect, useRef, useState } from 'react'
import type { Album, SearchSong, Track } from '../../shared/types'
import { ArtistSearchContext } from './components/ArtistLink'
import { Icon } from './components/Icon'
import { LyricsPanel } from './components/LyricsPanel'
import { Particles } from './components/mascot/Particles'
import { Splash } from './components/mascot/Splash'
import { PlayerBar } from './components/PlayerBar'
import { type PlaysLater, QueuePanel } from './components/QueuePanel'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { UpdatePrompt } from './components/UpdatePrompt'
import { type SettingsSection, sidebarKey } from './navigation'
import { PageContent } from './PageContent'
import { queueEdges } from './queue'
import { looksLikeSource } from './source'
import { useAppearance } from './theme/useAppearance'
import { useAlbumLoader, useLoadedAlbums } from './useAlbumLoader'
import { useNavigation } from './useNavigation'
import { useNowPlaying } from './useNowPlaying'
import { usePlayer } from './usePlayer'
import { usePlayHistory } from './usePlayHistory'
import { usePlaylists } from './usePlaylists'
import { useQueue } from './useQueue'
import { useRatings } from './useRatings'
import { useSearches } from './useSearches'
import { useSidebarCollapsed } from './useSidebarCollapsed'
import { useToast } from './useToast'
import { UpNextContext, useUpNext } from './useUpNext'

/** The app shell: wires the hooks to the top bar, sidebar, page and player bar. */
export function App() {
  const [toast, setToast] = useToast()
  // The panel on the right: lyrics or the queue, one at a time.
  const [panel, setPanel] = useState<'lyrics' | 'queue' | null>(null)
  const togglePanel = (which: 'lyrics' | 'queue') => setPanel(open => (open === which ? null : which))
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
  // Asked first whenever playback moves on: songs queued to play next go ahead of the album.
  const beforeNextRef = useRef<() => boolean>(() => false)
  const onBeforeNext = useCallback(() => beforeNextRef.current(), [])
  const player = usePlayer(setToast, isDisliked, onEdge, onBeforeNext)
  const { playAt, playAfter, toggle } = player
  useNowPlaying(player)
  usePlayHistory(player)

  const nav = useNavigation()
  const { view, goTo } = nav
  const loaded = useLoadedAlbums()
  const queue = useQueue({ playAt, addAlbum: loaded.addAlbum, setToast })
  // What the player has now, for the queue to notice something else started while it was loading a song.
  const playingRef = useRef({ album: player.state.album, index: player.state.index })
  playingRef.current = { album: player.state.album, index: player.state.index }
  const playing = useCallback(() => playingRef.current, [])
  const onQueueExhausted = useCallback(() => void edgeRef.current(1), [])
  const upNext = useUpNext({
    playAt,
    playAfter,
    addAlbum: loaded.addAlbum,
    setToast,
    playing,
    onExhausted: onQueueExhausted
  })
  // Whichever of the queue and the playlist starts loading a song last wins: the other stops waiting for its own.
  beforeNextRef.current = () => {
    if (!upNext.playQueued()) return false
    queue.cancel()
    return true
  }
  edgeRef.current = direction => {
    // Previous on a queued song restarts it: there's no "before" in the queue.
    if (direction === -1 && upNext.isQueuedAlbum(player.state.album)) return false
    // After the queued songs: back to the album they cut into, or on through the playlist.
    if (direction === 1 && upNext.resume()) return true
    upNext.cancel()
    return queue.step(direction)
  }
  // Picking something to play ends what the queue would have gone back to (the queued songs stay).
  const { forgetResume } = upNext
  const playAlbumAt = useCallback(
    (album: Album, index: number) => {
      forgetResume()
      queue.playAlbumAt(album, index)
    },
    [forgetResume, queue.playAlbumAt]
  )
  const startQueue = useCallback(
    (...args: Parameters<typeof queue.startQueue>) => {
      forgetResume()
      queue.startQueue(...args)
    },
    [forgetResume, queue.startQueue]
  )
  const loader = useAlbumLoader({ loaded, nav, play: playAlbumAt, setToast })
  const { loadSource, openSearchAlbum, hashFor } = loader
  const { searches, runSearch } = useSearches({ page: nav.page, nav })

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
  const searchArtist = useCallback((artist: string) => void runSearch(artist.trim().slice(0, 200)), [runSearch])

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
  const goPlugins = useCallback(() => goSettings('plugins'), [goSettings])
  const goCharts = useCallback(() => goSettings('charts'), [goSettings])
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

  /** The rest of the playlist or album, which plays after the queued songs: for the queue panel. */
  const playsLater = (): PlaysLater | null => {
    const shown = 20
    const list = queue.queue
    if (list) {
      const songs = list.items.slice(list.position + 1, list.position + 1 + shown)
      return {
        label: list.label,
        songs: songs.map((s, i) => ({ id: `${i}:${s.id}`, title: s.title, artist: s.artist }))
      }
    }
    const { album, index } = player.state
    const from = upNext.resumesFrom() ?? (album && !upNext.isQueuedAlbum(album) ? { album, index } : null)
    if (!from) return null
    const tracks = from.album.tracks.slice(from.index + 1, from.index + 1 + shown)
    return { label: from.album.title, songs: tracks.map(t => ({ id: t.id, title: t.title, artist: t.artist })) }
  }

  return (
    <ArtistSearchContext.Provider value={searchArtist}>
      <UpNextContext.Provider value={upNext.actions}>
        <div
          className={`app ${player.track ? 'has-player' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${panel && player.track ? 'has-lyrics' : ''}`}
        >
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
              player={player}
              queue={queue.queue}
              ratings={ratings}
              playlists={playlists}
              looks={looks}
              onOpenAlbum={loader.openAlbum}
              onOpenSearchAlbum={openSearchAlbum}
              onOpenLibraryAlbum={loader.openLibraryAlbum}
              onPlaySong={playSong}
              isSongPlaying={isSongPlaying}
              onRetrySearch={query => void runSearch(query, false)}
              onPlayAlbumAt={playAlbumAt}
              onStartQueue={startQueue}
              onSettings={goSettings}
              onManagePlugins={goPlugins}
              onManageCharts={goCharts}
              onHome={goHome}
            />
          </main>
          <PlayerBar
            player={player}
            onOpenAlbum={() => playingHash && loader.openAlbum(playingHash)}
            ratings={ratings}
            playlists={playlists}
            seekThumb={looks.appearance.seekThumb}
            queue={queue.queue ? { label: queue.queue.label, ...queueEdges(queue.queue) } : undefined}
            lyricsOpen={panel === 'lyrics'}
            onToggleLyrics={() => togglePanel('lyrics')}
            queued={upNext.items.length}
            queueOpen={panel === 'queue'}
            onToggleQueue={() => togglePanel('queue')}
          />
          <LyricsPanel player={player} open={panel === 'lyrics'} mode={looks.appearance.mode} />
          <QueuePanel
            open={panel === 'queue'}
            track={player.track}
            artwork={player.state.album?.coverUrl}
            items={upNext.items}
            later={playsLater()}
            onMove={upNext.move}
            onRemove={upNext.remove}
            onClear={upNext.clear}
          />
          {toast && (
            <div className="toast" role="status">
              <span>{toast}</span>
              <button type="button" className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          <UpdatePrompt />
          {showSplash && <Splash />}
        </div>
      </UpNextContext.Provider>
    </ArtistSearchContext.Provider>
  )
}
