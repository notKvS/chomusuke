import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { LibraryView as Library, LibraryItem, LibraryResponse, SharingSettings } from '../../../shared/types'
import { formatBytes, formatSpeed, plural } from '../format'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'

const REFRESH_MS = 2000
const UPLOAD_LIMITS: Array<[number, string]> = [
  [0, 'Unlimited'],
  [5120, '5 MB/s'],
  [2048, '2 MB/s'],
  [1024, '1 MB/s'],
  [512, '512 KB/s'],
  [256, '256 KB/s'],
  [128, '128 KB/s'],
  [64, '64 KB/s']
]
const STREAM_CACHE_SIZES = [1, 2, 5, 10, 20]

/** Kept and streamed albums, and the sharing (seeding) settings. */
export function LibraryView({ onOpen }: { onOpen: (infoHash: string) => void }) {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => void window.chomusuke.getLibrary().then(setLibrary), [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const apply = (response: LibraryResponse) => {
    if (response.ok) {
      setLibrary(response.library)
      setError(null)
    } else setError(response.error)
  }

  const setSharing = async (patch: Partial<SharingSettings>) => {
    if (library) apply(await window.chomusuke.setSharing({ ...library.sharing, ...patch }))
  }
  const remove = async (infoHash: string) => apply(await window.chomusuke.removeFromLibrary(infoHash))

  if (!library) return <div className="page library" />
  const { sharing, items, streamed, streamedBytes, session } = library

  const status = (item: LibraryItem, background: boolean): string => {
    const progress = item.progress === undefined ? undefined : Math.round(item.progress * 100)
    if (!item.active) return sharing.enabled && background ? 'Starting…' : 'Not seeding (open it to play)'
    if (progress !== undefined && progress < 100) return `Downloading ${progress}%`
    return sharing.enabled
      ? `Seeding · ${plural(item.numPeers, 'peer')} · ↑ ${formatSpeed(item.uploadSpeed)}`
      : 'On this computer'
  }

  return (
    <div className="page library">
      <h1 className="search__title">Library</h1>
      <p className="sources__lead">
        Albums you keep are downloaded in full and stay on this computer, so they play instantly — even offline. What
        you stream is kept too, within the space you allow. While sharing is on, Chomusuke seeds all of it, so other
        listeners get their music from people like you.
      </p>
      {error && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      <section className="shelf">
        <h2 className="shelf__title">Sharing</h2>
        <div className="sharing">
          <SettingRow
            title="Share with other listeners"
            hint="Upload pieces of the music you play and keep to other people (seeding). Turn this off to only download: nothing is uploaded, from any torrent."
          >
            <Switch
              checked={sharing.enabled}
              label="Share with other listeners"
              onChange={enabled => void setSharing({ enabled })}
            />
          </SettingRow>
          <SettingRow
            title="Seed my library in the background"
            hint="Keep sharing every album you've kept whenever Chomusuke is open, not just what's playing."
            off={!sharing.enabled}
          >
            <Switch
              checked={sharing.seedLibrary}
              label="Seed my library in the background"
              disabled={!sharing.enabled}
              onChange={seedLibrary => void setSharing({ seedLibrary })}
            />
          </SettingRow>
          <SettingRow
            title="Keep seeding what I stream"
            hint="Whatever you've played stays on disk after you close Chomusuke and is seeded next time. Turn this off to clear it when the app closes."
          >
            <Switch
              checked={sharing.seedStreamed}
              label="Keep seeding what I stream"
              onChange={seedStreamed => void setSharing({ seedStreamed })}
            />
          </SettingRow>
          <SettingRow
            title="Space for streamed music"
            hint="When it's full, the albums you played longest ago make room. Kept albums don't count."
            off={!sharing.seedStreamed}
          >
            <select
              className="sharing__select"
              value={sharing.streamCacheGB}
              disabled={!sharing.seedStreamed}
              onChange={e => void setSharing({ streamCacheGB: Number(e.target.value) })}
              aria-label="Space for streamed music"
            >
              {STREAM_CACHE_SIZES.map(gb => (
                <option key={gb} value={gb}>
                  {gb} GB
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            title="Upload speed limit"
            hint="Leave room for everything else on your connection."
            off={!sharing.enabled}
          >
            <select
              className="sharing__select"
              value={sharing.uploadLimitKBps}
              disabled={!sharing.enabled}
              onChange={e => void setSharing({ uploadLimitKBps: Number(e.target.value) })}
              aria-label="Upload speed limit"
            >
              {UPLOAD_LIMITS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SettingRow>
          <p className="sharing__stats">
            <Icon name="upload" size={18} />
            {sharing.enabled
              ? `Shared ${formatBytes(session.uploaded)} this session · ${formatSpeed(session.uploadSpeed)} right now`
              : 'Not sharing — downloads only.'}
          </p>
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Saved albums</h2>
        {items.length === 0 ? (
          <div className="library__empty">
            <Sticker scene="library-empty" size={150}>
              <p>
                Open an album and press <strong>Save offline</strong> to add it here.
              </p>
            </Sticker>
          </div>
        ) : (
          <ul className="library__list">
            {items.map(item => (
              <AlbumRow
                key={item.infoHash}
                item={item}
                status={status(item, sharing.seedLibrary)}
                onOpen={onOpen}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </section>

      {sharing.seedStreamed && (
        <section className="shelf">
          <div className="library__heading">
            <h2 className="shelf__title">Recently streamed</h2>
            <span className="library__usage">
              {formatBytes(streamedBytes)} of {sharing.streamCacheGB} GB
            </span>
            {streamed.length > 0 && (
              <button
                type="button"
                className="ghost-button"
                onClick={async () => apply(await window.chomusuke.clearStreamed())}
              >
                Clear all
              </button>
            )}
          </div>
          {streamed.length === 0 ? (
            <p className="library__hint">
              Albums you play are added here when you close Chomusuke, with whatever you listened to.
            </p>
          ) : (
            <ul className="library__list">
              {streamed.map(item => (
                <AlbumRow
                  key={item.infoHash}
                  item={item}
                  status={status(item, true)}
                  onOpen={onOpen}
                  onRemove={remove}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function AlbumRow({
  item,
  status,
  onOpen,
  onRemove
}: {
  item: LibraryItem
  status: string
  onOpen: (infoHash: string) => void
  onRemove: (infoHash: string) => void
}) {
  const progress = item.progress === undefined ? undefined : Math.round(item.progress * 100)
  return (
    <li className="library-item">
      <button
        type="button"
        className="library-item__open"
        onClick={() => onOpen(item.infoHash)}
        title={`Open ${item.title}`}
      >
        <Cover src={item.coverUrl} size={56} />
        <span className="library-item__text">
          <span className="library-item__title">{item.title}</span>
          <span className="library-item__sub">{[item.artist, formatBytes(item.size)].filter(Boolean).join(' · ')}</span>
          <span className="library-item__status">{status}</span>
        </span>
      </button>
      {progress !== undefined && progress < 100 && (
        <span className="library-item__progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
      <span className="library-item__uploaded" title="Shared this session">
        ↑ {formatBytes(item.uploaded)}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${item.title}`}
        title="Remove (files are deleted when Chomusuke closes)"
        onClick={() => onRemove(item.infoHash)}
      >
        <Icon name="delete" size={20} />
      </button>
    </li>
  )
}

function SettingRow({
  title,
  hint,
  off,
  children
}: {
  title: string
  hint: string
  off?: boolean
  children: ReactNode
}) {
  return (
    <div className={`sharing__row ${off ? 'is-off' : ''}`}>
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      {children}
    </div>
  )
}

function Switch({
  checked,
  label,
  disabled,
  onChange
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}
