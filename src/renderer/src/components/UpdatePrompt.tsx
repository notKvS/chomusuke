import { useState } from 'react'
import { useUpdate } from '../useUpdate'
import { Icon } from './Icon'
import { Chomu } from './mascot/Chomu'
import './UpdatePrompt.css'

const SKIPPED_KEY = 'chomusuke.update-skipped'
const SKIP_MS = 7 * 24 * 60 * 60 * 1000

/** Whether "Later" was pressed on this version's "Download" prompt in the last 7 days. */
function isSkipped(version: string): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? 'null')
    return saved?.version === version && Date.now() < saved.until
  } catch {
    return false
  }
}

function skip(version: string): void {
  try {
    localStorage.setItem(SKIPPED_KEY, JSON.stringify({ version, until: Date.now() + SKIP_MS }))
  } catch {
    // Remembering is a convenience; the prompt still hides for this session.
  }
}

/**
 * Asks to restart once an update is downloaded, or offers to download a new version (in the app, or from its release
 * page where the app can't install it itself). "Later" on a download hides that version for 7 days; on a restart it
 * hides until next launch, and the downloaded update still installs when the app quits.
 */
export function UpdatePrompt() {
  const update = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const status = update?.status
  if (!status || (status.state !== 'ready' && status.state !== 'available') || dismissed === status.version) return null
  const ready = status.state === 'ready'
  if (!ready && isSkipped(status.version)) return null

  return (
    <div className="update-prompt" role="alert">
      <Chomu mood="happy" size={44} headOnly />
      <span>
        {ready ? `Chomusuke ${status.version} is ready. Restart to update.` : `Chomusuke ${status.version} is out.`}
      </span>
      <button
        type="button"
        className="solid-button"
        onClick={() => void (ready ? window.chomusuke.installUpdate() : window.chomusuke.downloadUpdate())}
      >
        {ready ? 'Restart now' : 'Download'}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          if (!ready) skip(status.version)
          setDismissed(status.version)
        }}
        aria-label="Later"
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
