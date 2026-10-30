import { type FormEvent, useState } from 'react'
import type { Playlist } from '../../../shared/types'
import { formatTime, plural } from '../format'
import type { Playlists } from '../usePlaylists'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'
import './AlbumView.css'
import './LikedView.css'
import './PlaylistView.css'

/** One playlist: play / shuffle, rename, reorder, remove songs, delete. */
export function PlaylistView({
  playlist,
  playlists,
  currentSongId,
  onPlay,
  onDeleted
}: {
  playlist: Playlist
  playlists: Playlists
  currentSongId: string | null
  /** Plays the playlist from `index`; `shuffle` plays it in random order. */
  onPlay: (index: number, shuffle?: boolean) => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(playlist.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const total = playlist.songs.reduce((sum, song) => sum + (song.duration ?? 0), 0)
  const empty = playlist.songs.length === 0

  const rename = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) await playlists.rename(playlist.id, name)
    setEditing(false)
  }

  return (
    <div className="page playlist">
      <header className="playlist__header">
        <span className="playlist__art">
          <Icon name="queueMusic" size={72} />
        </span>
        <div className="playlist__meta">
          <p className="shelf__eyebrow">Playlist</p>
          {editing ? (
            <form className="playlist__rename" onSubmit={rename}>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={100}
                aria-label="Playlist name"
                // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to rename
                autoFocus
                onBlur={() => setEditing(false)}
              />
            </form>
          ) : (
            <h1 className="album__title">
              {playlist.name}
              <button
                type="button"
                className="icon-button playlist__edit"
                aria-label="Rename playlist"
                onClick={() => {
                  setName(playlist.name)
                  setEditing(true)
                }}
              >
                <Icon name="edit" size={20} />
              </button>
            </h1>
          )}
          <p className="album__details">
            {plural(playlist.songs.length, 'song')}
            {total > 0 && <> • {formatTime(total)}</>}
          </p>
          <div className="album__actions">
            <button
              type="button"
              className="big-play"
              onClick={() => onPlay(0)}
              disabled={empty}
              aria-label="Play playlist"
            >
              <Icon name="play" size={32} />
            </button>
            <button type="button" className="ghost-button" onClick={() => onPlay(0, true)} disabled={empty}>
              <Icon name="shuffle" size={18} /> Shuffle
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="solid-button"
                  onClick={async () => {
                    await playlists.remove(playlist.id)
                    onDeleted()
                  }}
                >
                  Delete “{playlist.name}”
                </button>
                <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="ghost-button" onClick={() => setConfirmDelete(true)}>
                <Icon name="delete" size={18} /> Delete
              </button>
            )}
          </div>
        </div>
      </header>

      {empty ? (
        <div className="library__empty">
          <Sticker scene="playlist-empty" size={150}>
            <p>
              Use the <Icon name="playlistAdd" size={16} /> button on any track, in the player or on the Liked songs
              page to add music from any source.
            </p>
          </Sticker>
        </div>
      ) : (
        <ol className="liked__list">
          {playlist.songs.map((song, index) => (
            <li key={song.id} className={`liked-song ${song.id === currentSongId ? 'is-current' : ''}`}>
              <button
                type="button"
                className="liked-song__play"
                onClick={() => onPlay(index)}
                title={`Play ${song.title}`}
              >
                <span className="playlist__index">{index + 1}</span>
                <span className="liked-song__text">
                  <span className="liked-song__title">{song.title}</span>
                  <span className="liked-song__sub">{[song.artist, song.album].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <span className="liked-song__duration">{song.duration ? formatTime(song.duration) : ''}</span>
              <span className="playlist__order">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${song.title} up`}
                  disabled={index === 0}
                  onClick={() => void playlists.move(playlist.id, index, index - 1)}
                >
                  <Icon name="arrowUp" size={20} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${song.title} down`}
                  disabled={index === playlist.songs.length - 1}
                  onClick={() => void playlists.move(playlist.id, index, index + 1)}
                >
                  <Icon name="arrowDown" size={20} />
                </button>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${song.title} from the playlist`}
                title="Remove from playlist"
                onClick={() => void playlists.removeSong(playlist.id, song.id)}
              >
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
