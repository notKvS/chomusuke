import type { Track } from '../../../shared/types'
import type { UpNextItem } from '../upNext'
import { Cover } from './Cover'
import { Icon } from './Icon'
import './QueuePanel.css'

/** Songs after the queue: the rest of the album or playlist that's playing. */
export interface PlaysLater {
  label: string
  songs: Array<{ id: string; title: string; artist?: string }>
}

/**
 * What plays next, in a panel on the right side of the app (the queue button in the player bar opens it): the song
 * playing now, the songs you queued (reorder, remove, clear), then the rest of the album or playlist.
 */
export function QueuePanel({
  open,
  track,
  artwork,
  items,
  later,
  onMove,
  onRemove,
  onClear
}: {
  open: boolean
  track: Track | null
  artwork?: string
  items: UpNextItem[]
  later: PlaysLater | null
  onMove: (from: number, to: number) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  if (!open || !track) return null
  return (
    // The side panel's frame and glass are the lyrics panel's (LyricsPanel.css); only one of them is open at a time.
    <aside className="lyrics up-next" aria-label="Queue">
      <header className="lyrics__head">
        <div className="lyrics__title">
          <h2>Queue</h2>
        </div>
      </header>

      <div className="lyrics__body">
        <h3 className="up-next__heading">Now playing</h3>
        <div className="up-next__song is-current">
          <Cover src={artwork} size={40} />
          <SongText title={track.title} artist={track.artist} />
        </div>

        <div className="up-next__heading-row">
          <h3 className="up-next__heading">Next in queue</h3>
          {items.length > 0 && (
            <button type="button" className="pill-button" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="up-next__empty">Use “Play next” or “Add to queue” on any song to line it up here.</p>
        ) : (
          <ol className="up-next__list">
            {items.map((item, index) => (
              <li key={item.id} className="up-next__song">
                <Cover src={item.artwork} size={40} />
                <SongText title={item.title} artist={item.artist} />
                <span className="up-next__actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    aria-label={`Move ${item.title} up`}
                  >
                    <Icon name="arrowUp" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === items.length - 1}
                    onClick={() => onMove(index, index + 1)}
                    aria-label={`Move ${item.title} down`}
                  >
                    <Icon name="arrowDown" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.title} from the queue`}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        {later && later.songs.length > 0 && (
          <>
            <h3 className="up-next__heading">Next from {later.label}</h3>
            <ol className="up-next__list">
              {later.songs.map(song => (
                <li key={song.id} className="up-next__song is-later">
                  <SongText title={song.title} artist={song.artist} />
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </aside>
  )
}

function SongText({ title, artist }: { title: string; artist?: string }) {
  return (
    <span className="up-next__text">
      <span className="up-next__title">{title}</span>
      {artist && <span className="up-next__artist">{artist}</span>}
    </span>
  )
}
