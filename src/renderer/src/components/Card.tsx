import type { ReactNode } from 'react'
import { Cover } from './Cover'
import { Icon } from './Icon'
import './Card.css'

interface CardProps {
  artwork?: string
  title: string
  /** May hold links (e.g. the artist); `subtitleText` is its plain-text tooltip. */
  subtitle: ReactNode
  subtitleText?: string
  badge?: string
  /** Short labels from the source (format, licence, genre…) */
  tags?: string[]
  onOpen: (autoplay: boolean) => void
}

/** Square album card: click opens the album, the hover play button starts it. */
export function Card({ artwork, title, subtitle, subtitleText, badge, tags, onOpen }: CardProps) {
  const chips = (tags ?? []).filter(tag => tag !== badge)
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
      <span className="card__subtitle" title={subtitleText ?? (typeof subtitle === 'string' ? subtitle : undefined)}>
        {subtitle}
      </span>
      {(badge || chips.length > 0) && (
        <span className="card__tags">
          {badge && <span className="card__badge">{badge}</span>}
          {chips.map(tag => (
            <span key={tag} className="card__tag">
              {tag}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
