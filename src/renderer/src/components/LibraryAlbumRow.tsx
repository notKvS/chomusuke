import type { LibraryItem, SharingSettings } from '../../../shared/types'
import { formatBytes, formatSpeed, plural } from '../format'
import { Cover } from './Cover'
import { Icon } from './Icon'

/** One line about what an album on disk is doing; `background` is whether it seeds without being opened. */
export function libraryStatus(item: LibraryItem, sharing: SharingSettings, background: boolean): string {
  const progress = item.progress === undefined ? undefined : Math.round(item.progress * 100)
  if (!item.active) return sharing.enabled && background ? 'Starting…' : 'Not seeding (open it to play)'
  if (progress !== undefined && progress < 100) return `Downloading ${progress}%`
  return sharing.enabled
    ? `Seeding · ${plural(item.numPeers, 'peer')} · ↑ ${formatSpeed(item.uploadSpeed)}`
    : 'On this computer'
}

/** A kept or streamed album: opens it, shows its progress and what it has shared, and removes it. */
export function LibraryAlbumRow({
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
