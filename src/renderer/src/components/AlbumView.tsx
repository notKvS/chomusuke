import type { Album, TorrentStats } from '../../../shared/types'
import { formatBytes, formatSpeed, formatTime, plural } from '../format'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { Chomu } from './mascot/Chomu'
import { LoaderScene } from './mascot/LoaderScene'

interface Props {
  album: Album
  stats?: TorrentStats
  durations: Record<string, number>
  currentTrackId: string | null
  isPlaying: boolean
  onPlay: (index: number) => void
  onToggle: () => void
}

export function AlbumView({ album, stats, durations, currentTrackId, isPlaying, onPlay, onToggle }: Props) {
  const albumIsCurrent = album.tracks.some(t => t.id === currentTrackId)

  return (
    <div className="page album">
      <header className="album__header">
        <Cover src={album.coverUrl} className="album__cover" />
        <div className="album__meta">
          <h1 className="album__title">{album.title}</h1>
          <p className="album__subtitle">
            Album{album.artist && <> • {album.artist}</>}
          </p>
          <p className="album__details">
            {plural(album.tracks.length, 'song')} • {formatBytes(album.totalSize)}
          </p>
          <SwarmStatus stats={stats} />
          <div className="album__actions">
            <button
              type="button"
              className="big-play"
              onClick={() => (albumIsCurrent ? onToggle() : onPlay(0))}
              aria-label={albumIsCurrent && isPlaying ? 'Pause' : 'Play album'}
            >
              <Icon name={albumIsCurrent && isPlaying ? 'pause' : 'play'} size={32} />
            </button>
          </div>
        </div>
      </header>

      <ol className="tracklist">
        {album.tracks.map((track, index) => {
          const isCurrent = track.id === currentTrackId
          return (
            <li key={track.id}>
              <button
                type="button"
                className={`track ${isCurrent ? 'is-current' : ''}`}
                onClick={() => (isCurrent ? onToggle() : onPlay(index))}
                onDoubleClick={() => onPlay(index)}
              >
                <span className="track__index">
                  {isCurrent && isPlaying ? (
                    <span className="eq" aria-label="Playing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <span className="track__number">{track.trackNo ?? index + 1}</span>
                  )}
                  <Icon name={isCurrent && isPlaying ? 'pause' : 'play'} className="track__hover-icon" />
                </span>
                <span className="track__title">{track.title}</span>
                <span className="track__artist">{track.artist ?? ''}</span>
                <span className="track__format">{track.format}</span>
                <span className="track__duration">
                  {(durations[track.id] ?? track.duration)
                    ? formatTime(durations[track.id] ?? track.duration ?? 0)
                    : formatBytes(track.size)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function SwarmStatus({ stats }: { stats?: TorrentStats }) {
  if (!stats) return null
  const healthy = stats.numPeers > 0
  return (
    <p className="swarm" title="Peers and web seeds currently connected">
      <span className={`swarm__dot ${healthy ? 'is-up' : ''}`} />
      <Icon name="peers" size={16} />
      {plural(stats.numPeers, 'peer')}
      {stats.downloadSpeed > 1024 && (
        <>
          <Icon name="download" size={16} />
          {formatSpeed(stats.downloadSpeed)}
        </>
      )}
    </p>
  )
}

export function AlbumLoading({ title, artist }: { title?: string; artist?: string; artwork?: string }) {
  return (
    <div className="page album is-loading">
      <LoaderScene compact title="Loading" subtitle={[title ?? 'Opening torrent', artist].filter(Boolean).join(' — ')} />
    </div>
  )
}

export function AlbumError({ message, onRetry, onHome }: { message: string; onRetry?: () => void; onHome: () => void }) {
  return (
    <div className="page error-page">
      <Chomu mood="sad" size={280} />
      <h1>Nyaa… couldn't open that torrent</h1>
      <p>{message}</p>
      <div className="error-page__actions">
        {onRetry && (
          <button type="button" className="solid-button" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="ghost-button" onClick={onHome}>
          Back to home
        </button>
      </div>
    </div>
  )
}
