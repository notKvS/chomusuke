import type { Track } from '../../../shared/types'
import type { Ratings } from '../useRatings'
import { Icon } from './Icon'
import './RateButtons.css'

/** Like / dislike toggles for one track. A rating matched from another release shows faded until set here. */
export function RateButtons({
  infoHash,
  track,
  ratings,
  size = 18
}: {
  infoHash: string
  track: Pick<Track, 'key' | 'title' | 'artist'>
  ratings: Ratings
  size?: number
}) {
  const { rating, exact } = ratings.ratingOf(infoHash, track)
  const toggle = (value: 1 | -1) => {
    void ratings.rate(infoHash, track.key, exact && rating === value ? 0 : value)
  }
  const elsewhere = 'You rated this song in another release'
  return (
    <span className="rate">
      <button
        type="button"
        className={`icon-button rate__button ${rating === 1 ? 'is-on' : ''} ${rating === 1 && !exact ? 'is-similar' : ''}`}
        aria-pressed={rating === 1 && exact}
        aria-label={`Like ${track.title}`}
        title={rating === 1 && !exact ? elsewhere : 'Like'}
        onClick={event => {
          event.stopPropagation()
          toggle(1)
        }}
      >
        <Icon name={rating === 1 ? 'thumbUp' : 'thumbUpOutline'} size={size} />
      </button>
      <button
        type="button"
        className={`icon-button rate__button ${rating === -1 ? 'is-on is-down' : ''} ${rating === -1 && !exact ? 'is-similar' : ''}`}
        aria-pressed={rating === -1 && exact}
        aria-label={`Dislike ${track.title}`}
        title={rating === -1 && !exact ? elsewhere : 'Dislike (skipped when the album plays on)'}
        onClick={event => {
          event.stopPropagation()
          toggle(-1)
        }}
      >
        <Icon name={rating === -1 ? 'thumbDown' : 'thumbDownOutline'} size={size} />
      </button>
    </span>
  )
}
