import { useState } from 'react'
import { useUpdate } from '../useUpdate'
import { Icon } from './Icon'
import { Chomu } from './mascot/Chomu'
import './UpdatePrompt.css'

/**
 * Asks to restart once an update is downloaded, or (where the app can't install it itself) links the new release.
 * "Later" hides it for that version until next launch; a downloaded update still installs when the app quits.
 */
export function UpdatePrompt() {
  const update = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const status = update?.status
  if (!status || (status.state !== 'ready' && status.state !== 'available') || dismissed === status.version) return null
  const ready = status.state === 'ready'

  return (
    <div className="update-prompt" role="alert">
      <Chomu mood="happy" size={44} headOnly />
      <span>
        {ready ? `Chomusuke ${status.version} is ready. Restart to update.` : `Chomusuke ${status.version} is out.`}
      </span>
      <button
        type="button"
        className="solid-button"
        onClick={() => void (ready ? window.chomusuke.installUpdate() : window.chomusuke.openUpdatePage())}
      >
        {ready ? 'Restart now' : 'Download'}
      </button>
      <button type="button" className="icon-button" onClick={() => setDismissed(status.version)} aria-label="Later">
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
