import type { Album } from '../../../shared/types'
import { FEATURED, type FeaturedAlbum } from '../featured'
import { Card } from './Card'
import { Chomu } from './mascot/Chomu'
import './Home.css'

const GREETINGS: Array<[number, string, string]> = [
  [5, 'おはよう', 'Good morning'],
  [12, 'こんにちは', 'Good afternoon'],
  [18, 'こんばんは', 'Good evening'],
  [24, 'おやすみ…?', 'Up late, huh']
]
const LINES = [
  'What are we vibing to today?',
  'Chomusuke has warmed up the swarm for you.',
  'Pick something. Chomusuke’s ears are ready.',
  'Fresh seeds, crisp bits, zero ads. Nya.'
]

function Hero() {
  const hour = new Date().getHours()
  const [, jp, en] = GREETINGS.find(([until]) => hour < until) ?? GREETINGS[3]
  const line = LINES[new Date().getDate() % LINES.length]
  return (
    <section className="hero">
      <div className="hero__text">
        <p className="hero__jp">{jp}!</p>
        <h1 className="hero__title">{en} ✧</h1>
        <p className="hero__line">{line}</p>
      </div>
      <div className="hero__mascot">
        <Chomu mood={hour >= 23 || hour < 5 ? 'sleep' : 'happy'} size={190} />
      </div>
    </section>
  )
}

interface Props {
  albums: Album[]
  onOpenFeatured: (album: FeaturedAlbum, autoplay: boolean) => void
  onOpenAlbum: (infoHash: string, autoplay: boolean) => void
}

export function Home({ albums, onOpenFeatured, onOpenAlbum }: Props) {
  return (
    <div className="page home">
      <Hero />
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
        <p className="shelf__eyebrow">Picked for you</p>
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
    </div>
  )
}
