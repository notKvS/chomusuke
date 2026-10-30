import { type ReactNode, useEffect, useState } from 'react'
import type { Album, TorrentDetails } from '../../../shared/types'
import { formatBytes, formatSpeed, plural } from '../format'
import { Icon } from './Icon'
import './TorrentPanel.css'

const REFRESH_MS = 2000
const SHOWN_FILES = 60

/** Live torrent details for a loaded album, refreshed every couple of seconds. */
export function useTorrentDetails(infoHash: string): [TorrentDetails | null, () => void] {
  const [details, setDetails] = useState<TorrentDetails | null>(null)
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` forces an immediate refresh after an action
  useEffect(() => {
    let cancelled = false
    const load = () =>
      void window.chomusuke.getTorrentDetails(infoHash).then(next => {
        if (!cancelled) setDetails(next)
      })
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [infoHash, tick])
  return [details, () => setTick(t => t + 1)]
}

/** "Save offline" / "Saved offline" button for the album header: downloads the whole album into the library. */
export function KeepButton({
  album,
  details,
  onChanged
}: {
  album: Album
  details: TorrentDetails | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kept = details?.kept ?? false

  const toggle = async () => {
    setBusy(true)
    const response = kept
      ? await window.chomusuke.removeFromLibrary(album.infoHash)
      : await window.chomusuke.keepAlbum(album.infoHash, {
          title: album.title,
          artist: album.artist,
          coverUrl: album.coverUrl
        })
    setBusy(false)
    setError(response.ok ? null : response.error)
    onChanged()
  }

  return (
    <>
      <button
        type="button"
        className={kept ? 'ghost-button is-kept' : 'solid-button'}
        onClick={() => void toggle()}
        disabled={busy || !details}
        title={
          kept
            ? 'Saved on this computer — click to remove it (files are deleted when Chomusuke closes)'
            : 'Download the whole album so it plays instantly, even offline'
        }
      >
        <Icon name={kept ? 'check' : 'download'} size={18} />
        {kept ? 'Saved offline' : 'Save offline'}
      </button>
      {error && <span className="album__action-error">{error}</span>}
    </>
  )
}

/** The torrent behind an album: metadata, magnet link, .torrent download, trackers, files and live transfer. */
export function TorrentPanel({ details }: { details: TorrentDetails | null }) {
  const [note, setNote] = useState<string | null>(null)
  const [showAllTrackers, setShowAllTrackers] = useState(false)

  if (!details) return <p className="torrent-panel__empty">Loading torrent details…</p>

  const flash = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(null), 2500)
  }

  const saveFile = async () => {
    const result = await window.chomusuke.saveTorrentFile(details.infoHash)
    if (result?.ok) flash('Saved the .torrent file.')
    else if (result) flash(result.error)
  }

  const copyMagnet = async () => {
    flash((await window.chomusuke.copyMagnet(details.infoHash)) ? 'Magnet link copied.' : 'That torrent isn’t loaded.')
  }

  const trackers = showAllTrackers ? details.trackers : details.trackers.slice(0, 5)
  const ratio = details.downloaded > 0 ? details.uploaded / details.downloaded : 0

  return (
    <section className="torrent-panel" aria-label="Torrent details">
      <div className="torrent-panel__actions">
        <button type="button" className="solid-button" onClick={() => void saveFile()}>
          <Icon name="download" size={18} /> Save .torrent file
        </button>
        <button type="button" className="ghost-button" onClick={() => void copyMagnet()}>
          <Icon name="link" size={18} /> Copy magnet link
        </button>
        {note && (
          <span className="torrent-panel__note" role="status">
            {note}
          </span>
        )}
      </div>

      <dl className="torrent-panel__facts">
        <Fact label="Name" value={details.name} />
        <Fact label="Info hash" value={<code className="selectable">{details.infoHash}</code>} />
        <Fact label="Size" value={`${formatBytes(details.size)} in ${plural(details.fileCount, 'file')}`} />
        <Fact label="Pieces" value={`${details.pieceCount.toLocaleString()} × ${formatBytes(details.pieceLength)}`} />
        <Fact label="Peers" value={plural(details.numPeers, 'peer')} />
        <Fact
          label="Transfer"
          value={`↓ ${formatSpeed(details.downloadSpeed)} · ↑ ${formatSpeed(details.uploadSpeed)}`}
        />
        <Fact
          label="This session"
          value={`${formatBytes(details.downloaded)} down · ${formatBytes(details.uploaded)} up · ratio ${ratio.toFixed(2)}`}
        />
        {details.created && <Fact label="Created" value={new Date(details.created).toLocaleDateString()} />}
        {details.createdBy && <Fact label="Created by" value={details.createdBy} />}
        {details.comment && <Fact label="Comment" value={details.comment} />}
      </dl>

      {details.trackers.length > 0 && (
        <div className="torrent-panel__block">
          <h3>Trackers</h3>
          <ul className="torrent-panel__trackers">
            {trackers.map(tracker => (
              <li key={tracker} className="selectable">
                {tracker}
              </li>
            ))}
          </ul>
          {details.trackers.length > 5 && (
            <button type="button" className="link-button" onClick={() => setShowAllTrackers(v => !v)}>
              {showAllTrackers ? 'Show fewer' : `Show all ${details.trackers.length}`}
            </button>
          )}
        </div>
      )}

      <div className="torrent-panel__block">
        <h3>Files</h3>
        <ul className="torrent-panel__files">
          {details.files.slice(0, SHOWN_FILES).map(file => (
            <li key={file.path} className={file.playable ? '' : 'is-extra'}>
              <span className="torrent-panel__path selectable" title={file.path}>
                {file.path}
              </span>
              <span className="torrent-panel__size">{formatBytes(file.size)}</span>
              <span className="torrent-panel__progress" title={`${Math.round(file.progress * 100)}% on disk`}>
                <span style={{ width: `${Math.round(file.progress * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
        {details.fileCount > SHOWN_FILES && (
          <p className="torrent-panel__more">…and {plural(details.fileCount - SHOWN_FILES, 'more file')}</p>
        )}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}
