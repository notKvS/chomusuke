import { useState } from 'react'
import type { RatedSong } from '../../../shared/types'
import { formatTime } from '../format'
import type { Playlists } from '../usePlaylists'
import type { Ratings } from '../useRatings'
import { AddToPlaylist } from './AddToPlaylist'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'
import './LikedView.css'

/** Liked and disliked songs. */
export function LikedView({
  ratings,
  playlists,
  onPlay
}: {
  ratings: Ratings
  playlists: Playlists
  /** Plays `songs` in order, starting at `index`. */
  onPlay: (songs: RatedSong[], index: number) => void
}) {
  const [tab, setTab] = useState<1 | -1>(1)
  const songs = ratings.songs.filter(song => song.rating === tab)

  return (
    <div className="page liked">
      <h1 className="search__title">Liked songs</h1>
      <p className="sources__lead">
        Ratings follow the song, not the source: a song is remembered by its torrent and file, and also recognised by
        artist and title in other releases. Disliked songs are skipped when an album plays on.
      </p>

      <div className="liked__toolbar">
        <button
          type="button"
          className="solid-button"
          onClick={() => onPlay(songs, 0)}
          disabled={songs.length === 0 || tab === -1}
        >
          <Icon name="play" size={18} /> Play all
        </button>
        <AddToPlaylist
          playlists={playlists}
          songs={songs}
          label="Add all of these to a playlist"
          className="liked__add-all"
        />
      </div>
      <div className="chips" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 1}
          className={`chip ${tab === 1 ? 'is-active' : ''}`}
          onClick={() => setTab(1)}
        >
          Liked ({ratings.songs.filter(s => s.rating === 1).length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === -1}
          className={`chip ${tab === -1 ? 'is-active' : ''}`}
          onClick={() => setTab(-1)}
        >
          Disliked ({ratings.songs.filter(s => s.rating === -1).length})
        </button>
      </div>

      {songs.length === 0 ? (
        <div className="library__empty">
          <Sticker scene={tab === 1 ? 'liked-empty' : 'disliked-empty'} size={150}>
            <p>
              {tab === 1
                ? 'Use the thumbs-up next to any track or in the player.'
                : 'Thumbs-down a track to skip it next time.'}
            </p>
          </Sticker>
        </div>
      ) : (
        <ol className="liked__list">
          {songs.map((song, index) => (
            <li key={song.id} className="liked-song">
              <button
                type="button"
                className="liked-song__play"
                onClick={() => onPlay(songs, index)}
                title={`Play ${song.title}`}
              >
                <Icon name="play" size={22} />
                <span className="liked-song__text">
                  <span className="liked-song__title">{song.title}</span>
                  <span className="liked-song__sub">{[song.artist, song.album].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <span className="liked-song__duration">{song.duration ? formatTime(song.duration) : ''}</span>
              <span className="liked-song__date">{new Date(song.ratedAt).toLocaleDateString()}</span>
              <AddToPlaylist playlists={playlists} songs={[song]} label={`Add ${song.title} to a playlist`} />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove rating for ${song.title}`}
                title="Remove rating"
                onClick={() => void ratings.rate(song.infoHash, song.key, 0)}
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
