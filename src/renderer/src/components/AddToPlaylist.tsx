import { type FormEvent, useState } from 'react'
import type { SongRef } from '../../../shared/types'
import { songItem, type UpNextItem } from '../upNext'
import type { Playlists } from '../usePlaylists'
import { Icon } from './Icon'
import { QueueMenuItems, useMenuDismiss } from './QueueMenu'
import './AddToPlaylist.css'

/**
 * "+" button with a small menu: queue a song (play next, or at the end of the queue), or add it to an existing playlist
 * or to a new one. Pass either a loaded track (`infoHash` + `trackKey`, details read from the torrent) or known songs
 * (`songs`). `artwork` shows next to them in the queue.
 */
export function AddToPlaylist({
  playlists,
  infoHash,
  trackKey,
  songs,
  label,
  artwork,
  size = 18,
  className = ''
}: {
  playlists: Playlists
  infoHash?: string
  trackKey?: string
  songs?: SongRef[]
  label: string
  artwork?: string
  size?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const ref = useMenuDismiss(open, () => setOpen(false))

  const addTo = async (id: string, playlistName: string) => {
    if (songs) await playlists.addSongs(id, songs)
    else if (infoHash && trackKey) await playlists.addTrack(id, infoHash, trackKey)
    setDone(`Added to ${playlistName}`)
    setTimeout(() => {
      setDone(null)
      setOpen(false)
    }, 900)
  }

  const queueItems = async (): Promise<UpNextItem[]> => {
    if (songs) return songs.map(song => songItem(song, artwork))
    const song = infoHash && trackKey ? await window.chomusuke.songRef(infoHash, trackKey) : null
    return song ? [songItem(song, artwork)] : []
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
        title="Queue or add to a playlist"
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
              <QueueMenuItems items={queueItems} onDone={() => setOpen(false)} />
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
