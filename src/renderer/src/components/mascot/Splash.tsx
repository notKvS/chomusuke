import { useEffect, useState } from 'react'
import { LoaderScene } from './LoaderScene'
import './Splash.css'

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
    // Click-to-skip is a mouse nicety; the splash also dismisses itself after a couple of seconds.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div className={`splash ${phase === 'fade' ? 'is-fading' : ''}`} onClick={() => setPhase('fade')}>
      <LoaderScene title="Chomusuke" subtitle="Torrent music, served with whiskers" />
    </div>
  )
}
