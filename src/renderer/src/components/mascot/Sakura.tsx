// Drifting cherry-blossom petals behind the whole app. Purely decorative; disabled for reduced motion.
const PETALS = Array.from({ length: 12 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i * 1.7) % 14,
  duration: 12 + ((i * 5) % 9),
  size: 8 + ((i * 3) % 8),
  sway: i % 2 === 0 ? 'sakura-sway-a' : 'sakura-sway-b'
}))

export function Sakura() {
  return (
    <div className="sakura" aria-hidden="true">
      {PETALS.map((p, i) => (
        <span
          key={i}
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
