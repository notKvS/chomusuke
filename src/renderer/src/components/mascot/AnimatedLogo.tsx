import { useRef, useState } from 'react'
import { Chomu } from './Chomu'

const NYAS = ['nya~', 'nyaa!', '♪ ♫ ♪', 'feed me seeders', '(=^･ω･^=)', 'boop!', 'more bass pls', 'nyan nyan']

/** Animated brand: Chomu's face (blinks, twitches, dances while music plays) + wordmark. Click for a quip. */
export function AnimatedLogo({ playing, onHome }: { playing: boolean; onHome: () => void }) {
  const [bubble, setBubble] = useState<string | null>(null)
  const clicks = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const click = () => {
    onHome()
    clicks.current += 1
    setBubble(NYAS[clicks.current % NYAS.length])
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setBubble(null), 1600)
  }

  return (
    <button
      type="button"
      className={`brand ${playing ? 'is-playing' : ''}`}
      onClick={click}
      aria-label="Chomusuke home"
    >
      <span className="brand__mascot">
        <Chomu headOnly size={42} mood={playing ? 'listening' : 'idle'} dancing={playing} />
        {bubble && (
          <span className="brand__bubble" key={bubble + clicks.current}>
            {bubble}
          </span>
        )}
      </span>
      <span className="brand__word">
        <span className="brand__name">chomusuke</span>
      </span>
    </button>
  )
}
