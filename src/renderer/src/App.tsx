import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type {
  Album,
  LoadResult,
  SearchAlbum,
  SearchSong,
  SongRef,
  SourceHints,
  TorrentStats,
  Track
} from '../../shared/types'
import { AlbumError, AlbumLoading, AlbumView } from './components/AlbumView'
import { ExploreView } from './components/ExploreView'
import { Home } from './components/Home'
import { Icon } from './components/Icon'
import { LikedView } from './components/LikedView'
import { Chomu } from './components/mascot/Chomu'
import { Particles } from './components/mascot/Particles'
import { Splash } from './components/mascot/Splash'
import { PlayerBar } from './components/PlayerBar'
import { PlaylistView } from './components/PlaylistView'
import { SavedAlbumsView } from './components/SavedAlbumsView'
import { type SearchState, SearchView } from './components/SearchView'
import { Sidebar } from './components/Sidebar'
import { type SettingsSection, SettingsView } from './components/settings/SettingsView'
import { TopBar } from './components/TopBar'
import { looksLikeSource } from './source'
import { useAppearance } from './theme/useAppearance'
import { usePlayer } from './usePlayer'
import { usePlaylists } from './usePlaylists'
import { useRatings } from './useRatings'

/** Pages are what back/forward move between. */
type Page =
  | { kind: 'home' }
  | { kind: 'search'; query: string }
  | { kind: 'explore' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'saved' }
  | { kind: 'liked' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; infoHash: string }

/** Shown in place of the current page while an album loads or fails to; not part of the history. */
type Overlay =
  | { kind: 'loading'; title?: string; artist?: string; artwork?: string }
  | { kind: 'error'; message: string; retry?: () => void }

type View = Page | Overlay

/** A list of songs from any torrents played in order (a playlist, or the liked songs). */
interface Queue {
  label: string
  playlistId?: string
  items: SongRef[]
  position: number
}

/** What to start once an album has loaded: nothing, its first track, or a specific song. */
type Autoplay = boolean | { key: string }

const TOAST_MS = 6000
const MAX_HISTORY = 50
const MAX_CACHED_SEARCHES = 20
const SIDEBAR_KEY = 'chomusuke.sidebar-collapsed'

function savedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Collapses or expands the sidebar with a view transition: the browser animates snapshots of the old and new layout
 * on the compositor, so the page isn't laid out again on every frame the way a width transition would.
 */
function morphSidebar(update: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduced) {
    update()
    return
  }
  const root = document.documentElement
  // The sidebar and content are named only for the transition: a name makes an element a stacking context, which
  // would otherwise trap popup menus inside the content beneath the player bar.
  root.classList.add('is-morphing-sidebar')
  const transition = document.startViewTransition(() => flushSync(update))
  void transition.finished.finally(() => root.classList.remove('is-morphing-sidebar'))
}

function samePage(a: Page, b: Page): boolean {
  if (a.kind === 'album' && b.kind === 'album') return a.infoHash === b.infoHash
  if (a.kind === 'search' && b.kind === 'search') return a.query === b.query
  if (a.kind === 'playlist' && b.kind === 'playlist') return a.id === b.id
  if (a.kind === 'settings' && b.kind === 'settings') return a.section === b.section
  return a.kind === b.kind
}

export function App() {
  const [albums, setAlbums] = useState<Album[]>([])
  const [history, setHistory] = useState<{ pages: Page[]; index: number }>({ pages: [{ kind: 'home' }], index: 0 })
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  /** Results by query, so going back to a search shows it again without re-running it. */
  const [searches, setSearches] = useState<Record<string, SearchState>>({})
  const [stats, setStats] = useState<Record<string, TorrentStats>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(savedSidebarCollapsed)
  const looks = useAppearance()
  // Decided once at launch: turning the setting on later shouldn't replay the splash.
  const [showSplash] = useState(looks.appearance.splash)
  const ratings = useRatings()
  const { ratingOf } = ratings
  // Disliked songs are skipped when an album plays on (the track id starts with its torrent's info hash).
  const isDisliked = useCallback((track: Track) => ratingOf(track.id.slice(0, 40), track).rating === -1, [ratingOf])
  const playlists = usePlaylists()
  const [queue, setQueue] = useState<Queue | null>(null)
  const queueRef = useRef<Queue | null>(null)
  const queueLoad = useRef(0)
  // The player asks this to go past the end (or start) of the current album; filled in once playAt exists.
  const edgeRef = useRef<(direction: 1 | -1) => boolean>(() => false)
  const onEdge = useCallback((direction: 1 | -1) => edgeRef.current(direction), [])
  const player = usePlayer(setToast, isDisliked, onEdge)
  const { playAt, toggle } = player

  const setCurrentQueue = useCallback((next: Queue | null) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  /** Loads the queue item's torrent (no page change) and plays just that song; the queue then moves on. */
  const playQueueAt = useCallback(
    async (q: Queue, position: number): Promise<void> => {
      const item = q.items[position]
      if (!item) return setCurrentQueue(null)
      const current = { ...q, position }
      setCurrentQueue(current)
      const id = ++queueLoad.current
      const result = await window.chomusuke.loadSource(item.magnet, { title: item.album, artist: item.artist })
      if (id !== queueLoad.current || queueRef.current !== current) return // something else started playing
      const track = result.ok ? result.album.tracks.find(t => t.key === item.key) : undefined
      if (!result.ok || !track) {
        setToast(`Couldn't load “${item.title}” — skipping it.`)
        return playQueueAt(current, position + 1)
      }
      const album = result.album
      setAlbums(prev => (prev.some(a => a.infoHash === album.infoHash) ? prev : [album, ...prev]))
      playAt({ ...album, tracks: [track] }, 0)
    },
    [playAt, setCurrentQueue]
  )

  edgeRef.current = direction => {
    const q = queueRef.current
    const position = q ? q.position + direction : -1
    if (!q || position < 0 || position >= q.items.length) return false
    void playQueueAt(q, position)
    return true
  }

  const startQueue = useCallback(
    (label: string, items: SongRef[], start: number, options: { shuffle?: boolean; playlistId?: string } = {}) => {
      let list = items
      if (options.shuffle) {
        list = [...items]
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[list[i], list[j]] = [list[j], list[i]]
        }
      }
      void playQueueAt({ label, items: list, position: 0, playlistId: options.playlistId }, options.shuffle ? 0 : start)
    },
    [playQueueAt]
  )

  /** Playing from an album page or search ends any playlist that was playing. */
  const playAlbumAt = useCallback(
    (album: Album, index: number) => {
      setCurrentQueue(null)
      playAt(album, index)
    },
    [playAt, setCurrentQueue]
  )

  const page = history.pages[history.index]
  const view: View = overlay ?? page

  const requestId = useRef(0)
  const searchIds = useRef(new Map<string, number>())
  const nextSearchId = useRef(0)
  /** Loaded albums by the URL or search-result id they came from, so reopening is instant. */
  const sourceToHash = useRef(new Map<string, string>())
  const albumsRef = useRef(albums)
  const contentRef = useRef<HTMLElement>(null)
  /** Scroll position per page, restored when going back or forward. */
  const scrolls = useRef(new WeakMap<object, number>())

  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: scrolls.current.get(view) ?? 0 })
  }, [view])
  useEffect(() => {
    albumsRef.current = albums
  }, [albums])

  useEffect(() => window.chomusuke.onStats(list => setStats(Object.fromEntries(list.map(s => [s.infoHash, s])))), [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed))
    } catch {
      // Remembering is a convenience; the sidebar still toggles for this session.
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

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

  const navigate = useCallback((next: Page) => {
    setOverlay(null)
    setHistory(h => {
      if (samePage(h.pages[h.index], next)) return h
      const pages = [...h.pages.slice(0, h.index + 1), next].slice(-MAX_HISTORY)
      return { pages, index: pages.length - 1 }
    })
  }, [])

  const goBack = useCallback(() => {
    requestId.current++ // abandon any album load in flight
    if (overlay) return setOverlay(null)
    setHistory(h => (h.index > 0 ? { ...h, index: h.index - 1 } : h))
  }, [overlay])

  const goForward = useCallback(() => {
    requestId.current++
    setOverlay(null)
    setHistory(h => (h.index < h.pages.length - 1 ? { ...h, index: h.index + 1 } : h))
  }, [])

  const canGoBack = overlay !== null || history.index > 0
  const canGoForward = history.index < history.pages.length - 1

  // Mouse back/forward buttons and Alt+Left/Right, like a browser.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack()
      else if (e.button === 4) goForward()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') goBack()
      else goForward()
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [goBack, goForward])

  const showAlbum = useCallback(
    (album: Album, autoplay: Autoplay) => {
      setAlbums(prev => (prev.some(a => a.infoHash === album.infoHash) ? prev : [album, ...prev]))
      navigate({ kind: 'album', infoHash: album.infoHash })
      if (autoplay === true) playAlbumAt(album, 0)
      if (typeof autoplay === 'object') {
        const index = album.tracks.findIndex(t => t.key === autoplay.key)
        if (index >= 0) playAlbumAt(album, index)
        else setToast("That song isn't in this torrent's playable files — here's the rest of the album.")
      }
    },
    [navigate, playAlbumAt]
  )

  const runLoad = useCallback(
    async (
      load: () => Promise<LoadResult | null>,
      placeholder: Omit<Extract<Overlay, { kind: 'loading' }>, 'kind'>,
      onLoaded: (album: Album) => void,
      retry: () => void
    ) => {
      const id = ++requestId.current
      setOverlay({ kind: 'loading', ...placeholder })
      const result = await load()
      if (id !== requestId.current) return // a newer request or a navigation superseded this one
      if (!result) setOverlay(null)
      else if (result.ok) onLoaded(result.album)
      else setOverlay({ kind: 'error', message: result.error, retry })
    },
    []
  )

  const loadSource = useCallback(
    (source: string, hints?: SourceHints, artwork?: string, autoplay: Autoplay = false) => {
      const knownHash = sourceToHash.current.get(source)
      const known = albumsRef.current.find(a => a.infoHash === knownHash)
      if (known) return showAlbum(known, autoplay)

      void runLoad(
        () => window.chomusuke.loadSource(source, hints),
        { ...hints, artwork },
        album => {
          sourceToHash.current.set(source, album.infoHash)
          // Curated artwork is served over plain https and is more reliable than an image inside the torrent.
          const withArt = { ...album, coverUrl: artwork ?? album.coverUrl }
          setAlbums(prev => prev.map(a => (a.infoHash === album.infoHash ? withArt : a)))
          showAlbum(withArt, autoplay)
        },
        () => loadSource(source, hints, artwork, autoplay)
      )
    },
    [runLoad, showAlbum]
  )

  /** Runs a search and keeps its results; `show` also navigates to it. */
  const runSearch = useCallback(
    async (query: string, show = true) => {
      const id = ++nextSearchId.current
      searchIds.current.set(query, id)
      const store = (state: SearchState) =>
        setSearches(prev => {
          const next = { ...prev, [query]: state }
          const keys = Object.keys(next)
          for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_SEARCHES))) delete next[key]
          return next
        })
      store({ query, status: 'loading' })
      if (show) {
        requestId.current++ // cancel any album load in flight
        navigate({ kind: 'search', query })
      }
      const response = await window.chomusuke.search(query)
      if (searchIds.current.get(query) !== id) return
      store(
        response.ok
          ? { query, status: 'done', results: response.results }
          : { query, status: 'error', error: response.error }
      )
    },
    [navigate]
  )

  // Going back to a search whose results were dropped from the cache runs it again.
  const shownQuery = page.kind === 'search' ? page.query : null
  useEffect(() => {
    if (shownQuery !== null && !searches[shownQuery]) void runSearch(shownQuery, false)
  }, [shownQuery, searches, runSearch])

  const submitTopBar = useCallback(
    (input: string) => (looksLikeSource(input) ? loadSource(input) : void runSearch(input)),
    [loadSource, runSearch]
  )

  const openSearchAlbum = useCallback(
    (album: SearchAlbum, autoplay: Autoplay) => {
      const knownHash = sourceToHash.current.get(album.id)
      const known = albumsRef.current.find(a => a.infoHash === knownHash)
      if (known) return showAlbum(known, autoplay)

      void runLoad(
        () => window.chomusuke.openResult(album.id),
        { title: album.title, artist: album.artist, artwork: album.artwork },
        loaded => {
          sourceToHash.current.set(album.id, loaded.infoHash)
          const withArt = { ...loaded, coverUrl: album.artwork ?? loaded.coverUrl }
          setAlbums(prev => prev.map(a => (a.infoHash === loaded.infoHash ? withArt : a)))
          showAlbum(withArt, autoplay)
        },
        () => openSearchAlbum(album, autoplay)
      )
    },
    [runLoad, showAlbum]
  )

  const playSong = useCallback(
    (song: SearchSong) => {
      const hash = sourceToHash.current.get(song.album.id)
      if (hash && player.state.album?.infoHash === hash && player.track?.key === song.key) return toggle()
      openSearchAlbum(song.album, { key: song.key })
    },
    [openSearchAlbum, player.state.album, player.track, toggle]
  )

  const isSongPlaying = (song: SearchSong): boolean =>
    player.track?.key === song.key &&
    player.state.album?.infoHash !== undefined &&
    sourceToHash.current.get(song.album.id) === player.state.album.infoHash

  const openFile = useCallback(() => {
    void runLoad(
      () => window.chomusuke.openTorrentFile(),
      {},
      album => showAlbum(album, false),
      openFile
    )
  }, [runLoad, showAlbum])

  const openLibraryAlbum = useCallback(
    (infoHash: string) => {
      const loaded = albumsRef.current.find(a => a.infoHash === infoHash)
      if (loaded) return showAlbum(loaded, false)
      void runLoad(
        () => window.chomusuke.openLibraryAlbum(infoHash),
        {},
        album => showAlbum(album, false),
        () => openLibraryAlbum(infoHash)
      )
    },
    [runLoad, showAlbum]
  )

  const openAlbum = useCallback(
    (infoHash: string, autoplay = false) => {
      const album = albumsRef.current.find(a => a.infoHash === infoHash)
      if (album) showAlbum(album, autoplay)
    },
    [showAlbum]
  )

  const goTo = useCallback(
    (next: Page) => {
      requestId.current++
      navigate(next)
    },
    [navigate]
  )
  const goHome = useCallback(() => goTo({ kind: 'home' }), [goTo])
  const goSettings = useCallback(
    (section: SettingsSection = 'appearance') => goTo({ kind: 'settings', section }),
    [goTo]
  )
  const goSources = useCallback(() => goSettings('sources'), [goSettings])
  const goExplore = useCallback(() => goTo({ kind: 'explore' }), [goTo])
  const goSaved = useCallback(() => goTo({ kind: 'saved' }), [goTo])
  const goLiked = useCallback(() => goTo({ kind: 'liked' }), [goTo])
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
  const likedCount = ratings.songs.filter(song => song.rating === 1).length
  const activeKey =
    view.kind === 'album'
      ? view.infoHash
      : view.kind === 'playlist'
        ? `playlist:${view.id}`
        : view.kind === 'loading' || view.kind === 'error'
          ? ''
          : view.kind

  let content: ReactNode
  switch (view.kind) {
    case 'home':
      content = (
        <Home
          albums={albums}
          onOpenFeatured={(f, autoplay) =>
            loadSource(f.source, { title: f.title, artist: f.artist }, f.artwork, autoplay)
          }
          onOpenAlbum={openAlbum}
        />
      )
      break
    case 'search': {
      const search = searches[view.query] ?? { query: view.query, status: 'loading' }
      content = (
        <SearchView
          search={search}
          isPlaying={isSongPlaying}
          onPlaySong={playSong}
          onOpenAlbum={openSearchAlbum}
          onRetry={() => void runSearch(view.query, false)}
          onManageSources={goSources}
        />
      )
      break
    }
    case 'explore':
      content = <ExploreView onOpenAlbum={openSearchAlbum} onManageSources={goSources} />
      break
    case 'settings':
      content = (
        <SettingsView
          section={view.section}
          onSection={goSettings}
          looks={looks}
          ratings={ratings}
          onOpenAlbum={openLibraryAlbum}
        />
      )
      break
    case 'liked':
      content = (
        <LikedView
          ratings={ratings}
          playlists={playlists}
          onPlay={(songs, index) => startQueue('Liked songs', songs, index)}
        />
      )
      break
    case 'playlist': {
      const playlist = playlists.playlists.find(p => p.id === view.id)
      content = playlist ? (
        <PlaylistView
          playlist={playlist}
          playlists={playlists}
          currentSongId={
            queue?.playlistId === playlist.id && player.track ? (queue.items[queue.position]?.id ?? null) : null
          }
          onPlay={(index, shuffle) =>
            startQueue(playlist.name, playlist.songs, index, { shuffle, playlistId: playlist.id })
          }
          onDeleted={goHome}
        />
      ) : (
        <div className="page">
          <p className="sources__lead">That playlist no longer exists.</p>
        </div>
      )
      break
    }
    case 'saved':
      content = <SavedAlbumsView onOpen={openLibraryAlbum} />
      break
    case 'loading':
      content = <AlbumLoading title={view.title} artist={view.artist} artwork={view.artwork} />
      break
    case 'error':
      content = <AlbumError message={view.message} onRetry={view.retry} onHome={goHome} />
      break
    case 'album': {
      const album = albums.find(a => a.infoHash === view.infoHash)
      content = album ? (
        <AlbumView
          album={album}
          stats={stats[album.infoHash]}
          durations={player.durations}
          currentTrackId={player.track?.id ?? null}
          isPlaying={player.state.isPlaying}
          onPlay={index => playAlbumAt(album, index)}
          onToggle={toggle}
          ratings={ratings}
          playlists={playlists}
        />
      ) : null
      break
    }
  }

  return (
    <div className={`app ${player.track ? 'has-player' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      {looks.appearance.particles !== 'off' && (
        <Particles kind={looks.appearance.particles} count={looks.appearance.particleCount} />
      )}
      <TopBar
        onSubmit={submitTopBar}
        onHome={goHome}
        playing={player.state.isPlaying}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
      />
      <Sidebar
        active={activeKey}
        albums={albums}
        playingAlbum={playingHash}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => morphSidebar(() => setSidebarCollapsed(v => !v))}
        onHome={goHome}
        onExplore={goExplore}
        onSettings={() => goSettings()}
        onLiked={goLiked}
        likedCount={likedCount}
        onSaved={goSaved}
        playlists={playlists.playlists}
        onOpenPlaylist={goPlaylist}
        onCreatePlaylist={createPlaylist}
        onOpenAlbum={openAlbum}
        onOpenFile={openFile}
      />
      <main className="content" ref={contentRef} onScroll={e => scrolls.current.set(view, e.currentTarget.scrollTop)}>
        {content}
      </main>
      <PlayerBar
        player={player}
        stats={playingHash ? stats[playingHash] : undefined}
        onOpenAlbum={() => playingHash && openAlbum(playingHash)}
        ratings={ratings}
        playlists={playlists}
        queue={
          queue
            ? { label: queue.label, hasNext: queue.position + 1 < queue.items.length, hasPrev: queue.position > 0 }
            : undefined
        }
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
