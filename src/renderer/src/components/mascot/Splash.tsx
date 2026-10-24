import { useEffect, useState } from 'react'
import { LoaderScene } from './LoaderScene'

const SHOW_MS = 2200
const FADE_MS = 600

/** Opening screen shown once per launch while the app warms up. */
export function Splash() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show')

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fade = setTimeout(() => setPhase('fade'), reduced ? 400 : SHOW_MS)
    const gone = setTimeout(() => setPhase('gone'), (reduced ? 400 : SHOW_MS) + FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [])

  if (phase === 'gone') return null
  return (
    <div className={`splash ${phase === 'fade' ? 'is-fading' : ''}`} onClick={() => setPhase('fade')}>
      <LoaderScene title="Chomusuke" subtitle="Torrent music, served with whiskers" />
    </div>
  )
}
