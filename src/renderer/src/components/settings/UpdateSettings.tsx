import type { UpdateStatus } from '../../../../shared/types'
import { useUpdate } from '../../useUpdate'
import { SettingRow } from '../controls/SettingRow'
import { type Status, StatusLine } from '../controls/StatusLine'

function describe(status: UpdateStatus): Status | null {
  switch (status.state) {
    case 'off':
      return { kind: 'ok', text: 'Running from source: updates are off.' }
    case 'idle':
      return null
    case 'checking':
      return { kind: 'busy', text: 'Checking for updates…' }
    case 'up-to-date':
      return { kind: 'ok', text: 'You have the latest version.' }
    case 'downloading':
      return { kind: 'busy', text: `Downloading ${status.version}… ${status.percent}%` }
    case 'ready':
      return { kind: 'ok', text: `${status.version} is downloaded. Restart to update (or it installs when you quit).` }
    case 'available':
      return { kind: 'ok', text: `${status.version} is out. Download it from its release page.` }
    case 'error':
      return { kind: 'error', text: status.message }
  }
}

/** The installed version, and checking for (and installing) a newer one. */
export function UpdateSettings() {
  const update = useUpdate()
  if (!update) return null
  const { status } = update
  const line = describe(status)
  const busy = status.state === 'off' || status.state === 'checking' || status.state === 'downloading'

  return (
    <section className="shelf">
      <div className="sharing">
        <SettingRow
          title={`Chomusuke ${update.currentVersion}`}
          hint="New versions are checked for when the app opens and every few hours, and downloaded in the background."
        >
          {status.state === 'ready' ? (
            <button type="button" className="pill-button" onClick={() => void window.chomusuke.installUpdate()}>
              Restart now
            </button>
          ) : status.state === 'available' ? (
            <button type="button" className="pill-button" onClick={() => void window.chomusuke.openUpdatePage()}>
              Download
            </button>
          ) : (
            <button
              type="button"
              className="pill-button"
              disabled={busy}
              onClick={() => void window.chomusuke.checkForUpdates()}
            >
              Check for updates
            </button>
          )}
        </SettingRow>
      </div>
      {line && <StatusLine status={line} as="p" />}
    </section>
  )
}
