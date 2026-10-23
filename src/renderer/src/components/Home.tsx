import type { Album } from '../../../shared/types'
import { FEATURED, type FeaturedAlbum } from '../featured'
import { Card } from './Card'
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
          Search the Internet Archive's free music from the bar above, or paste any magnet link, info hash or https{' '}
          <code>.torrent</code> URL there. You can also open a <code>.torrent</code> file from the sidebar. Only the songs you
          play get downloaded.
        </p>
      </section>
    </div>
  )
}
