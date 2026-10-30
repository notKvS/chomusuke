import { useMemo } from 'react'
import type { Appearance } from '../../theme/appearance'
import './Particles.css'

// Decorative particles drifting behind the whole app: sakura petals, snow, leaves and more. Each particle is an outer
// span that travels and an inner element that sways, spins or pulses, both animating only transform and opacity, so
// the compositor does all the work. Hidden for reduced motion.

type Kind = Exclude<Appearance['particles'], 'off'>
type Motion = 'fall' | 'rise' | 'drift' | 'twinkle'

interface KindStyle {
  motion: Motion
  /** Seconds for one trip: base plus up to `spread` more. */
  duration: [base: number, spread: number]
  /** Particle size in px: base plus up to `spread` more. */
  size: [base: number, spread: number]
  glyphs?: string[]
}

const KINDS: Record<Kind, KindStyle> = {
  sakura: { motion: 'fall', duration: [12, 9], size: [8, 8] },
  snow: { motion: 'fall', duration: [14, 10], size: [6, 8] },
  leaves: { motion: 'fall', duration: [11, 8], size: [12, 10] },
  bubbles: { motion: 'rise', duration: [12, 9], size: [10, 20] },
  embers: { motion: 'rise', duration: [8, 7], size: [4, 5] },
  notes: { motion: 'rise', duration: [14, 8], size: [14, 12], glyphs: ['♪', '♫', '♬', '♩'] },
  fireflies: { motion: 'drift', duration: [10, 8], size: [10, 8] },
  sparkles: { motion: 'twinkle', duration: [3, 4], size: [12, 12] }
}

/** Evenly scattered but deterministic, so the layout doesn't jump when the count changes. */
function layout(kind: Kind, count: number) {
  const { motion, duration, size, glyphs } = KINDS[kind]
  return Array.from({ length: count }, (_, i) => {
    // Multipliers coprime with every spread + 1, so sizes and speeds really vary.
    const trip = duration[0] + ((i * 7) % (duration[1] + 1))
    return {
      id: i,
      left: (i * 37) % 100,
      top: (i * 53 + 17) % 100,
      // Negative delays start every particle mid-trip, so the screen isn't empty at first.
      delay: -((i * 1.7) % trip),
      trip,
      // The inner motion runs faster than the trip: a few sways per fall, a pulse every couple of seconds.
      inner: motion === 'twinkle' ? trip : motion === 'drift' ? 1.5 + (i % 4) * 0.6 : trip / 3,
      size: size[0] + ((i * 11) % (size[1] + 1)),
      variant: i % 4,
      glyph: glyphs?.[i % glyphs.length]
    }
  })
}

/** The particle layer behind the app. `count` particles of one kind; the reduced-motion stylesheet hides it. */
export function Particles({ kind, count }: { kind: Kind; count: number }) {
  const list = useMemo(() => layout(kind, count), [kind, count])
  const { motion } = KINDS[kind]
  return (
    <div className={`particles particles--${kind} particles--${motion}`} aria-hidden="true">
      {list.map(p => (
        <span
          key={p.id}
          className="particle"
          style={{
            left: `${p.left}%`,
            top: motion === 'drift' || motion === 'twinkle' ? `${p.top}%` : undefined,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.trip}s`
          }}
        >
          <i
            className={`particle__body v${p.variant}`}
            style={{
              // Notes are text, sized by font; the rest are shapes.
              width: p.glyph ? undefined : p.size,
              height: p.glyph ? undefined : kind === 'sakura' ? p.size * 0.8 : p.size,
              fontSize: p.glyph ? p.size : undefined,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.inner}s`
            }}
          >
            {p.glyph}
          </i>
        </span>
      ))}
    </div>
  )
}
