import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Album, LoadResult, SearchAlbum, SearchSong, SourceHints, TorrentStats, Track } from '../../shared/types'
import { AlbumError, AlbumLoading, AlbumView } from './components/AlbumView'
import { AppearanceView } from './components/AppearanceView'
import { ExploreView } from './components/ExploreView'
import { Home } from './components/Home'
import { Icon } from './components/Icon'
import { LibraryView } from './components/LibraryView'
import { LikedView } from './components/LikedView'
import { Chomu } from './components/mascot/Chomu'
import { Sakura } from './components/mascot/Sakura'
import { Splash } from './components/mascot/Splash'
import { PlayerBar } from './components/PlayerBar'
import { type SearchState, SearchView } from './components/SearchView'
import { Sidebar } from './components/Sidebar'
import { SourcesView } from './components/SourcesView'
import { TopBar } from './components/TopBar'
import { looksLikeSource } from './source'
import { useAppearance } from './theme/useAppearance'
import { usePlayer } from './usePlayer'
import { useRatings } from './useRatings'

/** Pages are what back/forward move between. */
type Page =
  | { kind: 'home' }
  | { kind: 'search'; query: string }
  | { kind: 'sources' }
  | { kind: 'explore' }
  | { kind: 'appearance' }
  | { kind: 'library' }
  | { kind: 'liked' }
  | { kind: 'album'; infoHash: string }

/** Shown in place of the current page while an album loads or fails to; not part of the history. */
type Overlay =
  | { kind: 'loading'; title?: string; artist?: string; artwork?: string }
  | { kind: 'error'; message: string; retry?: () => void }

type View = Page | Overlay

/** What to start once an album has loaded: nothing, its first track, or a specific song. */
type Autoplay = boolean | { key: string }

const TOAST_MS = 6000
const MAX_HISTORY = 50
const MAX_CACHED_SEARCHES = 20

function samePage(a: Page, b: Page): boolean {
  if (a.kind === 'album' && b.kind === 'album') return a.infoHash === b.infoHash
  if (a.kind === 'search' && b.kind === 'search') return a.query === b.query
  return a.kind === b.kind
}

export function App() {
  const [albums, setAlbums] = useState<Album[]>([])
  const [history, setHistory] = useState<{ pages: Page[]; index: number }>({ pages: [{ kind: 'home' }], index: 0 })
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  /** Results by query, so going back to a search shows it again without re-running it. */
  const [searches, setSearches] = useState<Record<string, SearchState>>({})
  const [lastQuery, setLastQuery] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, TorrentStats>>({})
  const [toast, setToast] = useState<string | null>(null)
  const looks = useAppearance()
  // Decided once at launch: turning the setting on later shouldn't replay the splash.
  const [showSplash] = useState(looks.appearance.splash)
  const ratings = useRatings()
  const { ratingOf } = ratings
  // Disliked songs are skipped when an album plays on (the track id starts with its torrent's info hash).
  const isDisliked = useCallback((track: Track) => ratingOf(track.id.slice(0, 40), track).rating === -1, [ratingOf])
  const player = usePlayer(setToast, isDisliked)
  const { playAt, toggle } = player

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
      if (autoplay === true) playAt(album, 0)
      if (typeof autoplay === 'object') {
        const index = album.tracks.findIndex(t => t.key === autoplay.key)
        if (index >= 0) playAt(album, index)
        else setToast("That song isn't in this torrent's playable files — here's the rest of the album.")
      }
    },
    [navigate, playAt]
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
      setLastQuery(query)
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
  const goSources = useCallback(() => goTo({ kind: 'sources' }), [goTo])
  const goExplore = useCallback(() => goTo({ kind: 'explore' }), [goTo])
  const goAppearance = useCallback(() => goTo({ kind: 'appearance' }), [goTo])
  const goLibrary = useCallback(() => goTo({ kind: 'library' }), [goTo])
  const goLiked = useCallback(() => goTo({ kind: 'liked' }), [goTo])
  const goSearch = useCallback(() => {
    if (lastQuery !== null) goTo({ kind: 'search', query: lastQuery })
  }, [goTo, lastQuery])

  const playingHash = player.state.album?.infoHash ?? null
  const activeKey =
    view.kind === 'album' ? view.infoHash : view.kind === 'loading' || view.kind === 'error' ? '' : view.kind

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
    case 'sources':
      content = <SourcesView />
      break
    case 'explore':
      content = <ExploreView onOpenAlbum={openSearchAlbum} onManageSources={goSources} />
      break
    case 'appearance':
      content = <AppearanceView controls={looks} />
      break
    case 'liked':
      content = (
        <LikedView
          ratings={ratings}
          looks={looks}
          onPlay={song =>
            loadSource(song.magnet, { title: song.album, artist: song.artist }, undefined, { key: song.key })
          }
        />
      )
      break
    case 'library':
      content = <LibraryView onOpen={openLibraryAlbum} />
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
          onPlay={index => playAt(album, index)}
          onToggle={toggle}
          ratings={ratings}
        />
      ) : null
      break
    }
  }

  return (
    <div className={`app ${player.track ? 'has-player' : ''}`}>
      {looks.appearance.sakura && <Sakura count={looks.appearance.petals} />}
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
        hasSearch={lastQuery !== null}
        onHome={goHome}
        onSearch={goSearch}
        onSources={goSources}
        onExplore={goExplore}
        onAppearance={goAppearance}
        onLibrary={goLibrary}
        onLiked={goLiked}
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
