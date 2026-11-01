import { useEffect, useState } from 'react'
import type { DiscordStatus, SharingSettings as Sharing } from '../../../../shared/types'
import { formatBytes, formatSpeed } from '../../format'
import { useLibrary } from '../../useLibrary'
import { SettingRow } from '../controls/SettingRow'
import { Switch } from '../controls/Switch'
import { Icon } from '../Icon'
import { LibraryAlbumRow, libraryStatus } from '../LibraryAlbumRow'
import './SharingSettings.css'

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

const POLL_MS = 2000

/** Whether the Discord status is getting through, checked while it's switched on. */
function DiscordStatusLine({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<DiscordStatus | null>(null)

  useEffect(() => {
    if (!enabled) return setStatus(null)
    let live = true
    const poll = () => void window.chomusuke.getDiscordStatus().then(next => live && setStatus(next))
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled])

  if (!enabled || !status || status.kind === 'off') return null
  const problem = status.kind === 'not-running' || status.kind === 'refused'
  const text = {
    idle: 'Ready: play a song and it shows on Discord.',
    connected: 'Connected to Discord.',
    'not-running':
      "Can't reach the Discord desktop app. Open it (Discord in a browser can't show this); Chomusuke connects on its own.",
    refused: status.kind === 'refused' ? `Discord didn't accept the status: ${status.message}` : ''
  }[status.kind]
  return (
    <p className="sharing__stats">
      <Icon name={problem ? 'error' : status.kind === 'connected' ? 'check' : 'music'} size={18} />
      {text}
    </p>
  )
}

/** What Home knows about what you play, and a way to forget it. */
function HistorySettings() {
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => {
    void window.chomusuke.getHistorySize().then(setSize)
  }, [])

  const clear = async () => {
    await window.chomusuke.clearHistory()
    setSize(0)
  }

  return (
    <section className="shelf">
      <h2 className="shelf__title">Listening history</h2>
      <div className="sharing">
        <SettingRow
          title="Songs Home remembers"
          hint="Home suggests more from the artists and genres you play most. The list stays on this computer and holds your last 500 songs."
        >
          <button type="button" className="pill-button" disabled={!size} onClick={() => void clear()}>
            {size === null ? 'Clear history' : `Clear ${size} ${size === 1 ? 'song' : 'songs'}`}
          </button>
        </SettingRow>
      </div>
    </section>
  )
}

/** Seeding settings, and the space kept for music you've streamed. */
export function SharingSettings({ onOpenAlbum }: { onOpenAlbum: (infoHash: string) => void }) {
  const { library, error, apply, remove } = useLibrary()

  const setSharing = async (patch: Partial<Sharing>) => {
    if (library) apply(await window.chomusuke.setSharing({ ...library.sharing, ...patch }))
  }

  if (!library) return null
  const { sharing, streamed, streamedBytes, session } = library

  return (
    <>
      <p className="sources__lead">
        While sharing is on, Chomusuke seeds the albums you save and what you stream, so other listeners get their music
        from people like you.
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
            title="Seed my saved albums in the background"
            hint="Keep sharing every album you've saved whenever Chomusuke is open, not just what's playing."
            off={!sharing.enabled}
          >
            <Switch
              checked={sharing.seedLibrary}
              label="Seed my saved albums in the background"
              disabled={!sharing.enabled}
              onChange={seedLibrary => void setSharing({ seedLibrary })}
            />
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
        <h2 className="shelf__title">Streamed music</h2>
        <div className="sharing">
          <SettingRow
            title="Keep what I stream"
            hint="Whatever you've played stays on disk after you close Chomusuke and is seeded next time. Turn this off to clear it when the app closes."
          >
            <Switch
              checked={sharing.seedStreamed}
              label="Keep what I stream"
              onChange={seedStreamed => void setSharing({ seedStreamed })}
            />
          </SettingRow>
          <SettingRow
            title="Space for streamed music"
            hint="When it's full, the albums you played longest ago make room. Saved albums don't count."
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
        </div>

        {sharing.seedStreamed && (
          <>
            <div className="library__heading">
              <h3 className="shelf__title">Recently streamed</h3>
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
                  <LibraryAlbumRow
                    key={item.infoHash}
                    item={item}
                    status={libraryStatus(item, sharing, true)}
                    onOpen={onOpenAlbum}
                    onRemove={remove}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Discord</h2>
        <div className="sharing">
          <SettingRow
            title="Show what I'm listening to"
            hint="Your Discord status shows the song, artist and album while Discord is open, with a link for friends to get Chomusuke."
          >
            <Switch
              checked={sharing.discordStatus}
              label="Show what I'm listening to"
              onChange={discordStatus => void setSharing({ discordStatus })}
            />
          </SettingRow>
          <DiscordStatusLine enabled={sharing.discordStatus} />
        </div>
      </section>

      <HistorySettings />
    </>
  )
}
