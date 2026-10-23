import { Cover } from './Cover'
import { Icon } from './Icon'

interface CardProps {
  artwork?: string
  title: string
  subtitle: string
  badge?: string
  onOpen: (autoplay: boolean) => void
}

/** Square album card: click opens the album, the hover play button starts it. */
export function Card({ artwork, title, subtitle, badge, onOpen }: CardProps) {
  return (
    <div className="card">
      <div className="card__art">
        <button type="button" className="card__art-button" onClick={() => onOpen(false)} aria-label={`Open ${title}`}>
          <Cover src={artwork} />
        </button>
        <button type="button" className="card__play" onClick={() => onOpen(true)} aria-label={`Play ${title}`}>
          <Icon name="play" size={28} />
        </button>
      </div>
      <button type="button" className="card__title" onClick={() => onOpen(false)} tabIndex={-1} title={title}>
        {title}
      </button>
      <span className="card__subtitle" title={subtitle}>
        {subtitle}
      </span>
      {badge && <span className="card__badge">{badge}</span>}
    </div>
  )
}
