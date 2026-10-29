import type { ReactNode } from 'react'
import type { AppearanceControls } from '../../theme/useAppearance'
import type { Ratings } from '../../useRatings'
import { AppearanceSettings } from './AppearanceSettings'
import { BackupSettings } from './BackupSettings'
import { SharingSettings } from './SharingSettings'
import { SourcesSettings } from './SourcesSettings'

export type SettingsSection = 'appearance' | 'sources' | 'sharing' | 'backup'

const SECTIONS: Array<[SettingsSection, string]> = [
  ['appearance', 'Appearance'],
  ['sources', 'Sources'],
  ['sharing', 'Sharing & storage'],
  ['backup', 'Backup']
]

/** Every setting in one place, one section at a time. */
export function SettingsView({
  section,
  onSection,
  looks,
  ratings,
  onOpenAlbum
}: {
  section: SettingsSection
  onSection: (section: SettingsSection) => void
  looks: AppearanceControls
  ratings: Ratings
  onOpenAlbum: (infoHash: string) => void
}) {
  let body: ReactNode
  switch (section) {
    case 'appearance':
      body = <AppearanceSettings controls={looks} />
      break
    case 'sources':
      body = <SourcesSettings />
      break
    case 'sharing':
      body = <SharingSettings onOpenAlbum={onOpenAlbum} />
      break
    case 'backup':
      body = <BackupSettings ratings={ratings} looks={looks} />
      break
  }

  return (
    <div className="page settings">
      <h1 className="search__title">Settings</h1>
      <div className="chips settings__tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={section === id}
            aria-controls="settings-panel"
            className={`chip ${section === id ? 'is-active' : ''}`}
            onClick={() => onSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="settings__panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
        {body}
      </div>
    </div>
  )
}
