import { useEffect, useState } from 'react'
import scene from '../../assets/mascot/chomusuke-fire-scene.jpg'

const QUIPS = [
  'Chomusuke is chasing seeders around the neighbourhood…',
  'Negotiating with peers. They want grilled fish.',
  'Untangling the torrent yarn ball…',
  'Asking the DHT nicely. Very nicely.',
  'Polishing the bits until they sparkle ✧',
  'Downloading only the good parts…',
  'Charging an EXPLOSION-grade loading screen…',
  'Feeding the hamsters that power the swarm…',
  'Roasting a fish while the pieces arrive…',
  'Consulting the ancient scroll of info hashes…'
]

const EMBERS = Array.from({ length: 18 }, (_, i) => ({
  left: 30 + ((i * 23) % 40),
  delay: (i * 0.45) % 6,
  duration: 4 + ((i * 7) % 5),
  size: 3 + (i % 4)
}))

interface Props {
  /** Big title, e.g. Loading */
  title?: string
  subtitle?: string
  compact?: boolean
}

/** Loading screen: the fiery Chomusuke artwork with drifting embers, a glow pulse and rotating quips. */
export function LoaderScene({ title = 'Loading', subtitle, compact = false }: Props) {
  const [quip, setQuip] = useState(() => Math.floor(Math.random() * QUIPS.length))

  useEffect(() => {
    const timer = setInterval(() => setQuip(q => (q + 1) % QUIPS.length), 2600)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={`loader-scene ${compact ? 'is-compact' : ''}`} role="status" aria-live="polite">
      <img className="loader-scene__art" src={scene} alt="" draggable={false} />
      <div className="loader-scene__glow" aria-hidden="true" />
      <div className="loader-scene__embers" aria-hidden="true">
        {EMBERS.map((ember, i) => (
          <span
            key={i}
            style={{
              left: `${ember.left}%`,
              width: ember.size,
              height: ember.size,
              animationDelay: `${ember.delay}s`,
              animationDuration: `${ember.duration}s`
            }}
          />
        ))}
      </div>

      <div className="loader-scene__caption">
        <p className="loader-scene__title">
          {title}
          <span className="loader-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
        {subtitle && <p className="loader-scene__subtitle">{subtitle}</p>}
        <p className="loader-scene__quip" key={quip}>
          {QUIPS[quip]}
        </p>
      </div>
    </div>
  )
}
