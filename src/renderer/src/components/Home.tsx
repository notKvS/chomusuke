import type { Album, SearchAlbum } from '../../../shared/types'
import { ArtistLink } from './ArtistLink'
import { Card } from './Card'
import { HomeShelves } from './HomeShelves'
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
  onOpenAlbum: (infoHash: string, autoplay: boolean) => void
  onOpenSearchAlbum: (album: SearchAlbum, autoplay: boolean) => void
}

export function Home({ albums, onOpenAlbum, onOpenSearchAlbum }: Props) {
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
                subtitle={<>Album • {album.artist ? <ArtistLink name={album.artist} /> : 'Torrent'}</>}
                subtitleText={`Album • ${album.artist ?? 'Torrent'}`}
                onOpen={autoplay => onOpenAlbum(album.infoHash, autoplay)}
              />
            ))}
          </div>
        </section>
      )}

      <HomeShelves onOpenAlbum={onOpenSearchAlbum} />
    </div>
  )
}
