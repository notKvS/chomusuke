import { useState } from 'react'
import type { Album, TorrentStats } from '../../../shared/types'
import { formatBytes, formatSpeed, formatTime, plural } from '../format'
import type { Playlists } from '../usePlaylists'
import type { Ratings } from '../useRatings'
import { AddToPlaylist } from './AddToPlaylist'
import { ArtistLink } from './ArtistLink'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { LoaderScene } from './mascot/LoaderScene'
import { Sticker } from './mascot/Sticker'
import { RateButtons } from './RateButtons'
import { KeepButton, TorrentPanel, useTorrentDetails } from './TorrentPanel'
import './AlbumView.css'

interface Props {
  album: Album
  stats?: TorrentStats
  durations: Record<string, number>
  currentTrackId: string | null
  isPlaying: boolean
  onPlay: (index: number) => void
  onToggle: () => void
  ratings: Ratings
  playlists: Playlists
}

/**
 * An album's page: header with play, save offline and torrent details, then the track list with ratings and
 * add-to-playlist. Disliked tracks are dimmed, not hidden; lengths the player has measured (`durations`) win over tags.
 */
export function AlbumView({
  album,
  stats,
  durations,
  currentTrackId,
  isPlaying,
  onPlay,
  onToggle,
  ratings,
  playlists
}: Props) {
  const albumIsCurrent = album.tracks.some(t => t.id === currentTrackId)
  // An http album has no torrent: no swarm and nothing to save offline.
  const isTorrent = album.source !== 'http'
  const [details, refreshDetails] = useTorrentDetails(isTorrent ? album.infoHash : null)
  const [showTorrent, setShowTorrent] = useState(false)

  return (
    <div className="page album">
      <header className="album__header">
        <Cover src={album.coverUrl} className="album__cover" />
        <div className="album__meta">
          <h1 className="album__title">{album.title}</h1>
          <p className="album__subtitle">
            Album
            {album.artist && (
              <>
                {' '}
                • <ArtistLink name={album.artist} />
              </>
            )}
          </p>
          <p className="album__details">
            {plural(album.tracks.length, 'song')}
            {isTorrent && <> • {formatBytes(album.totalSize)}</>}
          </p>
          {isTorrent && <SwarmStatus stats={stats} />}
          <div className="album__actions">
            <button
              type="button"
              className="big-play"
              onClick={() => (albumIsCurrent ? onToggle() : onPlay(0))}
              aria-label={albumIsCurrent && isPlaying ? 'Pause' : 'Play album'}
            >
              <Icon name={albumIsCurrent && isPlaying ? 'pause' : 'play'} size={32} />
            </button>
            {isTorrent && (
              <>
                <KeepButton album={album} details={details} onChanged={refreshDetails} />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowTorrent(v => !v)}
                  aria-expanded={showTorrent}
                >
                  <Icon name="info" size={18} />
                  {showTorrent ? 'Hide torrent' : 'Torrent'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {isTorrent && showTorrent && <TorrentPanel details={details} />}

      <ol className="tracklist">
        {album.tracks.map((track, index) => {
          const isCurrent = track.id === currentTrackId
          return (
            <li
              key={track.id}
              className={`track-row ${ratings.ratingOf(album.infoHash, track).rating === -1 ? 'is-disliked' : ''}`}
            >
              <button
                type="button"
                className={`track ${isCurrent ? 'is-current' : ''}`}
                onClick={() => (isCurrent ? onToggle() : onPlay(index))}
                onDoubleClick={() => onPlay(index)}
              >
                <span className="track__index">
                  {isCurrent && isPlaying ? (
                    <span className="eq" role="img" aria-label="Playing">
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
                    : isTorrent && formatBytes(track.size)}
                </span>
              </button>
              <span className="track-actions">
                <AddToPlaylist
                  playlists={playlists}
                  infoHash={album.infoHash}
                  trackKey={track.key}
                  label={`Add ${track.title} to a playlist`}
                />
                <RateButtons infoHash={album.infoHash} track={track} ratings={ratings} />
              </span>
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

/** `finding`: a chart entry, so the providers are being searched for it first. */
export function AlbumLoading({
  title,
  artist,
  finding = false
}: {
  title?: string
  artist?: string
  artwork?: string
  finding?: boolean
}) {
  return (
    <div className="page album is-loading">
      <LoaderScene
        compact
        title={finding ? 'Finding your music' : 'Loading'}
        subtitle={[title ?? 'Opening album', artist].filter(Boolean).join(' — ')}
      />
    </div>
  )
}

export function AlbumError({
  message,
  onRetry,
  onHome
}: {
  message: string
  onRetry?: () => void
  onHome: () => void
}) {
  return (
    <div className="page error-page">
      <Sticker scene="album-error" size={200}>
        <h1>Couldn't open that album</h1>
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
      </Sticker>
    </div>
  )
}
