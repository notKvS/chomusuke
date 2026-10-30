import { useState } from 'react'
import { sanitizeAppearance } from '../../theme/appearance'
import type { AppearanceControls } from '../../theme/useAppearance'
import type { Ratings } from '../../useRatings'
import { type Status, StatusLine } from '../controls/StatusLine'
import { Icon } from '../Icon'
import './BackupSettings.css'

/** Export and import of ratings, saved albums and appearance. */
export function BackupSettings({ ratings, looks }: { ratings: Ratings; looks: AppearanceControls }) {
  const [status, setStatus] = useState<Status | null>(null)

  const exportBackup = async () => {
    const result = await window.chomusuke.exportBackup(looks.appearance)
    if (!result) return
    setStatus(
      result.ok
        ? { kind: 'ok', text: `Saved ${result.songs} rated songs and ${result.albums} saved albums to ${result.path}` }
        : { kind: 'error', text: result.error }
    )
  }

  const importBackup = async () => {
    const result = await window.chomusuke.importBackup()
    if (!result) return
    if (!result.ok) return setStatus({ kind: 'error', text: result.error })
    if (result.appearance) looks.replace(sanitizeAppearance(result.appearance))
    await ratings.reload()
    const albums = result.albums ? ` ${result.albums} saved albums are downloading again.` : ''
    setStatus({ kind: 'ok', text: `Imported ${result.songs} rated songs.${albums}` })
  }

  return (
    <>
      <p className="sources__lead">
        Save your liked and disliked songs, saved albums and appearance to a file, and import it into Chomusuke on
        another computer — Windows, macOS or Linux. Importing merges with what's there; saved albums are downloaded
        again.
      </p>
      <section className="shelf">
        <div className="backup__actions">
          <button type="button" className="solid-button" onClick={() => void exportBackup()}>
            <Icon name="download" size={18} /> Export backup…
          </button>
          <button type="button" className="ghost-button" onClick={() => void importBackup()}>
            <Icon name="upload" size={18} /> Import backup…
          </button>
        </div>
        {status && <StatusLine status={status} as="p" />}
      </section>
    </>
  )
}
