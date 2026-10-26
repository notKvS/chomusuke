import { useMemo } from 'react'

// Drifting cherry-blossom petals behind the whole app. Purely decorative; disabled for reduced motion.
const petals = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    left: (i * 37) % 100,
    delay: (i * 1.7) % 14,
    duration: 12 + ((i * 5) % 9),
    size: 8 + ((i * 3) % 8),
    sway: i % 2 === 0 ? 'sakura-sway-a' : 'sakura-sway-b'
  }))

export function Sakura({ count = 12 }: { count?: number }) {
  const list = useMemo(() => petals(count), [count])
  return (
    <div className="sakura" aria-hidden="true">
      {list.map(p => (
        <span
          key={p.id}
          className={`sakura__petal ${p.sway}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.8,
            animationDelay: `${p.delay}s, ${p.delay}s`,
            animationDuration: `${p.duration}s, ${p.duration / 3}s`
          }}
        />
      ))}
    </div>
  )
}
