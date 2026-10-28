import { useState } from 'react'
import type { RatedSong } from '../../../shared/types'
import { formatTime } from '../format'
import { sanitizeAppearance } from '../theme/appearance'
import type { AppearanceControls } from '../theme/useAppearance'
import type { Playlists } from '../usePlaylists'
import type { Ratings } from '../useRatings'
import { AddToPlaylist } from './AddToPlaylist'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'

type Status = { kind: 'ok' | 'error' | 'busy'; text: string } | null

/** Liked and disliked songs, plus backup export/import. */
export function LikedView({
  ratings,
  looks,
  playlists,
  onPlay
}: {
  ratings: Ratings
  looks: AppearanceControls
  playlists: Playlists
  /** Plays `songs` in order, starting at `index`. */
  onPlay: (songs: RatedSong[], index: number) => void
}) {
  const [tab, setTab] = useState<1 | -1>(1)
  const [status, setStatus] = useState<Status>(null)
  const songs = ratings.songs.filter(song => song.rating === tab)

  const exportBackup = async () => {
    const result = await window.chomusuke.exportBackup(looks.appearance)
    if (!result) return
    setStatus(
      result.ok
        ? { kind: 'ok', text: `Saved ${result.songs} rated songs and ${result.albums} kept albums to ${result.path}` }
        : { kind: 'error', text: result.error }
    )
  }

  const importBackup = async () => {
    const result = await window.chomusuke.importBackup()
    if (!result) return
    if (!result.ok) return setStatus({ kind: 'error', text: result.error })
    if (result.appearance) looks.replace(sanitizeAppearance(result.appearance))
    await ratings.reload()
    const albums = result.albums ? ` ${result.albums} kept albums are downloading into your library.` : ''
    setStatus({ kind: 'ok', text: `Imported ${result.songs} rated songs.${albums}` })
  }

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

      <section className="shelf">
        <h2 className="shelf__title">Backup</h2>
        <p className="sources__help">
          Save your liked and disliked songs, kept albums and appearance to a file, and import it into Chomusuke on
          another computer — Windows, macOS or Linux. Importing merges with what's there; kept albums are downloaded
          again.
        </p>
        <div className="backup__actions">
          <button type="button" className="solid-button" onClick={() => void exportBackup()}>
            <Icon name="download" size={18} /> Export backup…
          </button>
          <button type="button" className="ghost-button" onClick={() => void importBackup()}>
            <Icon name="upload" size={18} /> Import backup…
          </button>
        </div>
        {status && (
          <p className={`torznab-form__status is-${status.kind}`} role="status">
            <Icon name={status.kind === 'error' ? 'error' : 'check'} size={18} />
            {status.text}
          </p>
        )}
      </section>
    </div>
  )
}
