import type { Album } from '../../../shared/types'
import { FEATURED, type FeaturedAlbum } from '../featured'
import { Cover } from './Cover'
import { Icon } from './Icon'

interface Props {
  albums: Album[]
  onOpenFeatured: (album: FeaturedAlbum, autoplay: boolean) => void
  onOpenAlbum: (infoHash: string, autoplay: boolean) => void
}

export function Home({ albums, onOpenFeatured, onOpenAlbum }: Props) {
  return (
    <div className="page home">
      {albums.length > 0 && (
        <section className="shelf">
          <p className="shelf__eyebrow">This session</p>
          <h2 className="shelf__title">Listen again</h2>
          <div className="shelf__grid">
            {albums.map(album => (
              <Card
                key={album.infoHash}
                artwork={album.coverUrl}
                title={album.title}
                subtitle={`Album • ${album.artist ?? 'Torrent'}`}
                onOpen={autoplay => onOpenAlbum(album.infoHash, autoplay)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="shelf">
        <p className="shelf__eyebrow">Free &amp; legal torrents</p>
        <h2 className="shelf__title">Featured albums</h2>
        <div className="shelf__grid">
          {FEATURED.map(album => (
            <Card
              key={album.id}
              artwork={album.artwork}
              title={album.title}
              subtitle={`Album • ${album.artist}`}
              badge={album.license}
              onOpen={autoplay => onOpenFeatured(album, autoplay)}
            />
          ))}
        </div>
      </section>

      <section className="hint">
        <Icon name="link" />
        <p>
          Paste any magnet link, 40-character info hash or https <code>.torrent</code> URL in the bar above, or open a{' '}
          <code>.torrent</code> file from the sidebar. Only the songs you play get downloaded.
        </p>
      </section>
    </div>
  )
}

interface CardProps {
  artwork?: string
  title: string
  subtitle: string
  badge?: string
  onOpen: (autoplay: boolean) => void
}

function Card({ artwork, title, subtitle, badge, onOpen }: CardProps) {
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
      <span className="card__subtitle">{subtitle}</span>
      {badge && <span className="card__badge">{badge}</span>}
    </div>
  )
}
