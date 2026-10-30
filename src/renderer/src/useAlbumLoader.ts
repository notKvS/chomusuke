import { useCallback, useEffect, useRef, useState } from 'react'
import type { Album, LoadResult, SearchAlbum, SourceHints } from '../../shared/types'
import type { Overlay } from './navigation'
import type { Navigation } from './useNavigation'

/** What to start once an album has loaded: nothing, its first track, or a specific song. */
export type Autoplay = boolean | { key: string }

/** Albums loaded this session, newest first (the sidebar list and Home's "Listen again"). */
export function useLoadedAlbums() {
  const [albums, setAlbums] = useState<Album[]>([])
  const albumsRef = useRef(albums)

  useEffect(() => {
    albumsRef.current = albums
  }, [albums])

  /** Adds an album to the list (no-op if it's already there). */
  const addAlbum = useCallback((album: Album) => {
    setAlbums(prev => (prev.some(a => a.infoHash === album.infoHash) ? prev : [album, ...prev]))
  }, [])

  /** The loaded album with this info hash; reads the latest list, so callbacks using it needn't change with it. */
  const findAlbum = useCallback(
    (infoHash: string | undefined) => albumsRef.current.find(a => a.infoHash === infoHash),
    []
  )

  return { albums, setAlbums, addAlbum, findAlbum }
}

export type LoadedAlbums = ReturnType<typeof useLoadedAlbums>

/**
 * The ways to open an album: a link, a search result, a library album or a .torrent file. While a load runs, a
 * loading overlay covers the page (an error overlay with retry if it fails). Albums are remembered by the link or
 * search-result id they came from, so reopening one is instant.
 */
export function useAlbumLoader({
  loaded,
  nav,
  play,
  setToast
}: {
  loaded: LoadedAlbums
  nav: Pick<Navigation, 'navigate' | 'setOverlay' | 'beginLoad'>
  play: (album: Album, index: number) => void
  setToast: (message: string) => void
}) {
  const { setAlbums, addAlbum, findAlbum } = loaded
  const { navigate, setOverlay, beginLoad } = nav
  /** Loaded albums by the URL or search-result id they came from, so reopening is instant. */
  const sourceToHash = useRef(new Map<string, string>())

  const showAlbum = useCallback(
    (album: Album, autoplay: Autoplay) => {
      addAlbum(album)
      navigate({ kind: 'album', infoHash: album.infoHash })
      if (autoplay === true) play(album, 0)
      if (typeof autoplay === 'object') {
        const index = album.tracks.findIndex(t => t.key === autoplay.key)
        if (index >= 0) play(album, index)
        else setToast("That song isn't in this torrent's playable files — here's the rest of the album.")
      }
    },
    [addAlbum, navigate, play, setToast]
  )

  const runLoad = useCallback(
    async (
      load: () => Promise<LoadResult | null>,
      placeholder: Omit<Extract<Overlay, { kind: 'loading' }>, 'kind'>,
      onLoaded: (album: Album) => void,
      retry: () => void
    ) => {
      const isCurrent = beginLoad()
      setOverlay({ kind: 'loading', ...placeholder })
      const result = await load()
      if (!isCurrent()) return // a newer request or a navigation superseded this one
      if (!result) setOverlay(null)
      else if (result.ok) onLoaded(result.album)
      else setOverlay({ kind: 'error', message: result.error, retry })
    },
    [beginLoad, setOverlay]
  )

  /** Shows the album already loaded from `source`; true if there was one. */
  const showKnown = useCallback(
    (source: string, autoplay: Autoplay): boolean => {
      const known = findAlbum(sourceToHash.current.get(source))
      if (known) showAlbum(known, autoplay)
      return known !== undefined
    },
    [showAlbum, findAlbum]
  )

  /** Remembers where a loaded album came from and shows it with the curated artwork, if any. */
  const showLoaded = useCallback(
    (source: string, album: Album, artwork: string | undefined, autoplay: Autoplay) => {
      sourceToHash.current.set(source, album.infoHash)
      // Curated artwork is served over plain https and is more reliable than an image inside the torrent.
      const withArt = { ...album, coverUrl: artwork ?? album.coverUrl }
      setAlbums(prev => prev.map(a => (a.infoHash === album.infoHash ? withArt : a)))
      showAlbum(withArt, autoplay)
    },
    [setAlbums, showAlbum]
  )

  /** Opens a magnet or torrent link. */
  const loadSource = useCallback(
    (source: string, hints?: SourceHints, artwork?: string, autoplay: Autoplay = false) => {
      if (showKnown(source, autoplay)) return
      void runLoad(
        () => window.chomusuke.loadSource(source, hints),
        { ...hints, artwork },
        album => showLoaded(source, album, artwork, autoplay),
        () => loadSource(source, hints, artwork, autoplay)
      )
    },
    [runLoad, showKnown, showLoaded]
  )

  const openSearchAlbum = useCallback(
    (album: SearchAlbum, autoplay: Autoplay) => {
      if (showKnown(album.id, autoplay)) return
      void runLoad(
        () => window.chomusuke.openResult(album.id),
        { title: album.title, artist: album.artist, artwork: album.artwork },
        loaded => showLoaded(album.id, loaded, album.artwork, autoplay),
        () => openSearchAlbum(album, autoplay)
      )
    },
    [runLoad, showKnown, showLoaded]
  )

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
      const loaded = findAlbum(infoHash)
      if (loaded) return showAlbum(loaded, false)
      void runLoad(
        () => window.chomusuke.openLibraryAlbum(infoHash),
        {},
        album => showAlbum(album, false),
        () => openLibraryAlbum(infoHash)
      )
    },
    [runLoad, showAlbum, findAlbum]
  )

  /** Shows an album loaded this session; does nothing for any other. */
  const openAlbum = useCallback(
    (infoHash: string, autoplay = false) => {
      const album = findAlbum(infoHash)
      if (album) showAlbum(album, autoplay)
    },
    [showAlbum, findAlbum]
  )

  /** The info hash of the album loaded from a link or search result, if it has been. */
  const hashFor = useCallback((source: string) => sourceToHash.current.get(source), [])

  return { loadSource, openSearchAlbum, openFile, openLibraryAlbum, openAlbum, hashFor }
}
