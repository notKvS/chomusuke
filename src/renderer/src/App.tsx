import { useCallback, useEffect, useRef, useState } from 'react'
import type { Album, LoadResult, SearchAlbum, SearchSong, SourceHints, TorrentStats } from '../../shared/types'
import { AlbumError, AlbumLoading, AlbumView } from './components/AlbumView'
import { Home } from './components/Home'
import { Icon } from './components/Icon'
import { PlayerBar } from './components/PlayerBar'
import { SearchView, type SearchState } from './components/SearchView'
import { Sidebar } from './components/Sidebar'
import { SourcesView } from './components/SourcesView'
import { ExploreView } from './components/ExploreView'
import { TopBar } from './components/TopBar'
import { Chomu } from './components/mascot/Chomu'
import { Sakura } from './components/mascot/Sakura'
import { Splash } from './components/mascot/Splash'
import { looksLikeSource } from './source'
import { usePlayer } from './usePlayer'

type View =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'sources' }
  | { kind: 'explore' }
  | { kind: 'loading'; title?: string; artist?: string; artwork?: string }
  | { kind: 'album'; infoHash: string }
  | { kind: 'error'; message: string; retry?: () => void }

/** What to start once an album has loaded: nothing, its first track, or a specific song. */
type Autoplay = boolean | { key: string }

const TOAST_MS = 6000

export function App() {
  const [albums, setAlbums] = useState<Album[]>([])
  const [view, setView] = useState<View>({ kind: 'home' })
  const [search, setSearch] = useState<SearchState | null>(null)
  const [stats, setStats] = useState<Record<string, TorrentStats>>({})
  const [toast, setToast] = useState<string | null>(null)
  const player = usePlayer(setToast)
  const { playAt, toggle } = player

  const viewRef = useRef(view)
  const requestId = useRef(0)
  const searchId = useRef(0)
  /** Loaded albums by the URL or search-result id they came from, so reopening is instant. */
  const sourceToHash = useRef(new Map<string, string>())
  const albumsRef = useRef(albums)
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    viewRef.current = view
    contentRef.current?.scrollTo({ top: 0 })
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

  const showAlbum = useCallback(
    (album: Album, autoplay: Autoplay) => {
      setAlbums(prev => (prev.some(a => a.infoHash === album.infoHash) ? prev : [album, ...prev]))
      setView({ kind: 'album', infoHash: album.infoHash })
      if (autoplay === true) playAt(album, 0)
      if (typeof autoplay === 'object') {
        const index = album.tracks.findIndex(t => t.key === autoplay.key)
        if (index >= 0) playAt(album, index)
        else setToast("That song isn't in this torrent's playable files — here's the rest of the album.")
      }
    },
    [playAt]
  )

  const runLoad = useCallback(
    async (
      load: () => Promise<LoadResult | null>,
      placeholder: Omit<Extract<View, { kind: 'loading' }>, 'kind'>,
      onLoaded: (album: Album) => void,
      retry: () => void
    ) => {
      const id = ++requestId.current
      const before = viewRef.current
      setView({ kind: 'loading', ...placeholder })
      const result = await load()
      if (id !== requestId.current) return // a newer request superseded this one
      if (!result) setView(before)
      else if (result.ok) onLoaded(result.album)
      else setView({ kind: 'error', message: result.error, retry })
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

  const runSearch = useCallback(async (query: string) => {
    const id = ++searchId.current
    requestId.current++ // cancel any album load in flight
    setSearch({ query, status: 'loading' })
    setView({ kind: 'search' })
    const response = await window.chomusuke.search(query)
    if (id !== searchId.current) return
    setSearch(
      response.ok
        ? { query, status: 'done', results: response.results }
        : { query, status: 'error', error: response.error }
    )
  }, [])

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

  const openAlbum = useCallback(
    (infoHash: string, autoplay = false) => {
      const album = albumsRef.current.find(a => a.infoHash === infoHash)
      if (album) showAlbum(album, autoplay)
    },
    [showAlbum]
  )

  const goHome = useCallback(() => {
    requestId.current++
    setView({ kind: 'home' })
  }, [])

  const goSearch = useCallback(() => {
    requestId.current++
    if (search) setView({ kind: 'search' })
  }, [search])

  const goSources = useCallback(() => {
    requestId.current++
    setView({ kind: 'sources' })
  }, [])

  const goExplore = useCallback(() => {
    requestId.current++
    setView({ kind: 'explore' })
  }, [])

  const playingHash = player.state.album?.infoHash ?? null
  const activeKey = view.kind === 'album' ? view.infoHash : ['home', 'search', 'sources', 'explore'].includes(view.kind) ? view.kind : ''

  let page
  switch (view.kind) {
    case 'home':
      page = (
        <Home
          albums={albums}
          onOpenFeatured={(f, autoplay) => loadSource(f.source, { title: f.title, artist: f.artist }, f.artwork, autoplay)}
          onOpenAlbum={openAlbum}
        />
      )
      break
    case 'search':
      page = search && (
        <SearchView
          search={search}
          isPlaying={isSongPlaying}
          onPlaySong={playSong}
          onOpenAlbum={openSearchAlbum}
          onRetry={() => void runSearch(search.query)}
          onManageSources={goSources}
        />
      )
      break
    case 'sources':
      page = <SourcesView />
      break
    case 'explore':
      page = <ExploreView onOpenAlbum={openSearchAlbum} onManageSources={goSources} />
      break
    case 'loading':
      page = <AlbumLoading title={view.title} artist={view.artist} artwork={view.artwork} />
      break
    case 'error':
      page = <AlbumError message={view.message} onRetry={view.retry} onHome={goHome} />
      break
    case 'album': {
      const album = albums.find(a => a.infoHash === view.infoHash)
      page = album ? (
        <AlbumView
          album={album}
          stats={stats[album.infoHash]}
          durations={player.durations}
          currentTrackId={player.track?.id ?? null}
          isPlaying={player.state.isPlaying}
          onPlay={index => playAt(album, index)}
          onToggle={toggle}
        />
      ) : null
      break
    }
  }

  return (
    <div className={`app ${player.track ? 'has-player' : ''}`}>
      <Sakura />
      <TopBar onSubmit={submitTopBar} onHome={goHome} playing={player.state.isPlaying} />
      <Sidebar
        active={activeKey}
        albums={albums}
        playingAlbum={playingHash}
        hasSearch={search !== null}
        onHome={goHome}
        onSearch={goSearch}
        onSources={goSources}
        onExplore={goExplore}
        onOpenAlbum={openAlbum}
        onOpenFile={openFile}
      />
      <main className="content" ref={contentRef}>
        {page}
      </main>
      <PlayerBar
        player={player}
        stats={playingHash ? stats[playingHash] : undefined}
        onOpenAlbum={() => playingHash && openAlbum(playingHash)}
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
      <Splash />
    </div>
  )
}
