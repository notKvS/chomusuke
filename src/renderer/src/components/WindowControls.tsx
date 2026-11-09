import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import './WindowControls.css'

/**
 * Minimise, maximise/restore and close, drawn by the app because the window has no native frame on Windows and
 * Linux (so the whole top bar follows the theme). macOS keeps its own traffic lights and renders nothing here.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const native = window.chomusuke.platform === 'darwin'

  useEffect(() => {
    if (native) return
    let current = true
    void window.chomusuke.isWindowMaximized().then(value => current && setMaximized(value))
    const stop = window.chomusuke.onWindowMaximized(setMaximized)
    return () => {
      current = false
      stop()
    }
  }, [native])

  if (native) return null
  return (
    <div className="window-controls">
      <button type="button" onClick={() => void window.chomusuke.windowControl('minimize')} aria-label="Minimise">
        <Icon name="minimize" size={16} />
      </button>
      <button
        type="button"
        onClick={() => void window.chomusuke.windowControl('toggle-maximize')}
        aria-label={maximized ? 'Restore' : 'Maximise'}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
      </button>
      <button
        type="button"
        className="window-controls__close"
        onClick={() => void window.chomusuke.windowControl('close')}
        aria-label="Close"
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
