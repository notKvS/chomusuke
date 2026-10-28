import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { SongRef } from '../../../shared/types'
import type { Playlists } from '../usePlaylists'
import { Icon } from './Icon'

/**
 * "+" button with a small menu: add a song to an existing playlist or to a new one. Pass either a loaded track
 * (`infoHash` + `trackKey`, details read from the torrent) or known songs (`songs`).
 */
export function AddToPlaylist({
  playlists,
  infoHash,
  trackKey,
  songs,
  label,
  size = 18,
  className = ''
}: {
  playlists: Playlists
  infoHash?: string
  trackKey?: string
  songs?: SongRef[]
  label: string
  size?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const addTo = async (id: string, playlistName: string) => {
    if (songs) await playlists.addSongs(id, songs)
    else if (infoHash && trackKey) await playlists.addTrack(id, infoHash, trackKey)
    setDone(`Added to ${playlistName}`)
    setTimeout(() => {
      setDone(null)
      setOpen(false)
    }, 900)
  }

  const createAndAdd = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const result = await playlists.create(trimmed)
    if (result.id) await addTo(result.id, trimmed)
    setName('')
  }

  return (
    <span className={`add-to-playlist ${className}`} ref={ref}>
      <button
        type="button"
        className="icon-button add-to-playlist__button"
        aria-label={label}
        title="Add to playlist"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation()
          setOpen(v => !v)
        }}
      >
        <Icon name="playlistAdd" size={size} />
      </button>
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only stops clicks reaching the row underneath
        <div className="playlist-menu" role="menu" onClick={event => event.stopPropagation()}>
          {done ? (
            <p className="playlist-menu__done">
              <Icon name="check" size={16} /> {done}
            </p>
          ) : (
            <>
              <p className="playlist-menu__title">Add to playlist</p>
              {playlists.playlists.map(playlist => (
                <button
                  key={playlist.id}
                  type="button"
                  role="menuitem"
                  className="playlist-menu__item"
                  onClick={() => void addTo(playlist.id, playlist.name)}
                >
                  <Icon name="queueMusic" size={18} />
                  <span>{playlist.name}</span>
                </button>
              ))}
              <form className="playlist-menu__new" onSubmit={createAndAdd}>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="New playlist…"
                  maxLength={100}
                  aria-label="New playlist name"
                />
                <button type="submit" className="icon-button" aria-label="Create playlist" disabled={!name.trim()}>
                  <Icon name="add" size={18} />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </span>
  )
}
