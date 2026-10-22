import { useCallback, useEffect, useRef, useState } from 'react'
import type { Album, LoadResult, SourceHints, TorrentStats } from '../../shared/types'
import { AlbumError, AlbumLoading, AlbumView } from './components/AlbumView'
import { Home } from './components/Home'
import { Icon } from './components/Icon'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { usePlayer } from './usePlayer'

type View =
  | { kind: 'home' }
  | { kind: 'loading'; title?: string; artist?: string; artwork?: string }
  | { kind: 'album'; infoHash: string }
  | { kind: 'error'; message: string; retry?: () => void }

const TOAST_MS = 6000

export function App() {
  const [albums, setAlbums] = useState<Album[]>([])
  const [view, setView] = useState<View>({ kind: 'home' })
  const [stats, setStats] = useState<Record<string, TorrentStats>>({})
  const [toast, setToast] = useState<string | null>(null)
  const player = usePlayer(setToast)
  const { playAt, toggle } = player

  const viewRef = useRef(view)
  const requestId = useRef(0)
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
    (album: Album, autoplay: boolean) => {
      setAlbums(prev => (prev.some(a => a.infoHash === album.infoHash) ? prev : [album, ...prev]))
      setView({ kind: 'album', infoHash: album.infoHash })
      if (autoplay) playAt(album, 0)
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
    (source: string, hints?: SourceHints, artwork?: string, autoplay = false) => {
      const knownHash = sourceToHash.current.get(source)
      const known = albumsRef.current.find(a => a.infoHash === knownHash)
      if (known) return showAlbum(known, autoplay)

      void runLoad(
        () => window.chomusuke.loadSource(source, hints),
        { ...hints, artwork },
        album => {
          sourceToHash.current.set(source, album.infoHash)
          // Curated artwork is served over plain https and is more reliable than an image inside the torrent.
          showAlbum({ ...album, coverUrl: artwork ?? album.coverUrl }, autoplay)
        },
        () => loadSource(source, hints, artwork, autoplay)
      )
    },
    [runLoad, showAlbum]
  )

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

  const playingHash = player.state.album?.infoHash ?? null
  const activeKey = view.kind === 'album' ? view.infoHash : view.kind === 'home' ? 'home' : ''

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
      <TopBar onSubmit={source => loadSource(source)} onHome={goHome} />
      <Sidebar
        active={activeKey}
        albums={albums}
        playingAlbum={playingHash}
        onHome={goHome}
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
          <Icon name="error" size={20} />
          <span>{toast}</span>
          <button type="button" className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
