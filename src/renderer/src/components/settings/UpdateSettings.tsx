import type { UpdateStatus } from '../../../../shared/types'
import { useLibrary } from '../../useLibrary'
import { useUpdate } from '../../useUpdate'
import { SettingRow } from '../controls/SettingRow'
import { type Status, StatusLine } from '../controls/StatusLine'
import { Switch } from '../controls/Switch'

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
  const { library, apply } = useLibrary()
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
      {library && (
        <div className="sharing">
          <SettingRow
            title="Developer tools"
            hint="F12 or Ctrl+Shift+I opens DevTools for the app, Ctrl+Shift+P for the plugins (to see why a source fails). Never paste anything someone sends you into the console."
          >
            <Switch
              checked={library.sharing.developerTools}
              label="Developer tools"
              onChange={developerTools =>
                void window.chomusuke.setSharing({ ...library.sharing, developerTools }).then(apply)
              }
            />
          </SettingRow>
        </div>
      )}
      <div className="sharing">
        <SettingRow
          title="Logs"
          hint="What the app did and what went wrong, kept in a small file on this computer. Send it along when you report a problem. It can include what you searched for and played, but never passwords or API keys."
        >
          <button type="button" className="pill-button" onClick={() => void window.chomusuke.openLogs()}>
            Open log folder
          </button>
        </SettingRow>
      </div>
    </section>
  )
}
