import { useState } from 'react'
import type { UpdateStatus } from '../../../../shared/types'
import { useLibrary } from '../../useLibrary'
import { useUpdate } from '../../useUpdate'
import { SettingRow } from '../controls/SettingRow'
import { type Status, StatusLine } from '../controls/StatusLine'
import { Switch } from '../controls/Switch'

function describe(status: UpdateStatus, selfUpdate: boolean): Status | null {
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
      return {
        kind: 'ok',
        text: selfUpdate ? `${status.version} is out.` : `${status.version} is out. Download it from its release page.`
      }
    case 'error':
      return { kind: 'error', text: status.message }
  }
}

/** The installed version, and checking for (and installing) a newer one. */
export function UpdateSettings() {
  const update = useUpdate()
  const { library, apply } = useLibrary()
  const [logLine, setLogLine] = useState<Status | null>(null)
  if (!update) return null
  const { status } = update
  const line = describe(status, update.selfUpdate)
  const busy = status.state === 'off' || status.state === 'checking' || status.state === 'downloading'
  const autoUpdate = update.selfUpdate && (library?.sharing.autoUpdate ?? true)

  return (
    <section className="shelf">
      <div className="sharing">
        <SettingRow
          title={`Chomusuke ${update.currentVersion}`}
          hint={
            autoUpdate
              ? 'New versions are checked for when the app opens and every few hours, and downloaded in the background.'
              : 'New versions are checked for when the app opens and every few hours. You choose whether to download them.'
          }
        >
          {status.state === 'ready' ? (
            <button type="button" className="pill-button" onClick={() => void window.chomusuke.installUpdate()}>
              Restart now
            </button>
          ) : status.state === 'available' ? (
            <button type="button" className="pill-button" onClick={() => void window.chomusuke.downloadUpdate()}>
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
      {library && update.selfUpdate && (
        <div className="sharing">
          <SettingRow
            title="Automatic updates"
            hint="Download new versions in the background. Off: you're asked first, and “Later” skips that version for 7 days."
          >
            <Switch
              checked={library.sharing.autoUpdate}
              label="Automatic updates"
              onChange={autoUpdate => void window.chomusuke.setSharing({ ...library.sharing, autoUpdate }).then(apply)}
            />
          </SettingRow>
        </div>
      )}
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
          hint="What the app did and what went wrong, kept in a small file on this computer. Send it along when you report a problem. It can include what you searched for and played, but never passwords or API keys. If a source finds nothing, the log says which one and for what search."
        >
          <button
            type="button"
            className="pill-button"
            onClick={() =>
              void window.chomusuke.exportLogs().then(result => {
                if (result === null) setLogLine(null)
                else
                  setLogLine(
                    result.ok ? { kind: 'ok', text: `Saved to ${result.path}` } : { kind: 'error', text: result.error }
                  )
              })
            }
          >
            Save log as a file
          </button>
          <button type="button" className="pill-button" onClick={() => void window.chomusuke.openLogs()}>
            Open log folder
          </button>
        </SettingRow>
        {logLine && <StatusLine status={logLine} as="p" />}
      </div>
    </section>
  )
}
