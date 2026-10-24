import { useEffect, useRef, type CSSProperties } from 'react'
import type { TorrentStats } from '../../../shared/types'
import { formatSpeed, formatTime, plural } from '../format'
import type { Player } from '../usePlayer'
import { Cover } from './Cover'
import { Icon } from './Icon'

interface Props {
  player: Player
  stats?: TorrentStats
  onOpenAlbum: () => void
}

export function PlayerBar({ player, stats, onOpenAlbum }: Props) {
  const { state, track, audio } = player
  const progressRef = useRef<HTMLDivElement>(null)

  // `timeupdate` only fires ~4×/s, which makes the bar step. While playing, follow the audio clock every
  // frame and write the position straight to a CSS variable (no React re-render per frame).
  useEffect(() => {
    const element = progressRef.current
    if (!element) return
    let frame = 0
    const paint = () => {
      const total = audio.duration
      const ratio = Number.isFinite(total) && total > 0 ? Math.min(1, audio.currentTime / total) : 0
      element.style.setProperty('--played', `${ratio * 100}%`)
      if (!audio.paused) frame = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(frame)
  }, [audio, state.isPlaying, state.currentTime, state.index])

  if (!track || !state.album) return null

  const { currentTime, duration, bufferedEnd } = state
  const pct = (value: number) => (duration > 0 ? `${Math.min(100, (value / duration) * 100)}%` : '0%')
  const hasPrev = state.index > 0 || currentTime > 0
  const hasNext = state.index + 1 < state.album.tracks.length
  const volumeIcon = state.muted || state.volume === 0 ? 'volumeOff' : state.volume < 0.5 ? 'volumeLow' : 'volume'

  return (
    <footer className="player">
      <div className="progress" ref={progressRef} style={{ '--buffered': pct(bufferedEnd) } as CSSProperties}>
        <div className="progress__track">
          <div className="progress__buffered" />
          <div className="progress__played" />
          <div className="progress__thumb" />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={e => player.seek(Number(e.target.value))}
          disabled={!duration}
          aria-label="Seek"
        />
      </div>

      <div className="player__controls">
        <button type="button" className="icon-button" onClick={player.prev} disabled={!hasPrev} aria-label="Previous">
          <Icon name="previous" size={28} />
        </button>
        <button
          type="button"
          className="icon-button player__play"
          onClick={player.toggle}
          aria-label={state.isPlaying ? 'Pause' : 'Play'}
        >
          {state.isBuffering && <span className="spinner spinner--ring" aria-hidden="true" />}
          <Icon name={state.isPlaying ? 'pause' : 'play'} size={40} />
        </button>
        <button type="button" className="icon-button" onClick={player.next} disabled={!hasNext} aria-label="Next">
          <Icon name="next" size={28} />
        </button>
        <span className="player__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <button type="button" className="player__now" onClick={onOpenAlbum} title="Go to album">
        <Cover src={state.album.coverUrl} size={40} />
        <span className="player__text">
          <span className="player__title">{track.title}</span>
          <span className="player__subtitle">
            {[track.artist, state.album.title].filter(Boolean).join(' • ')}
          </span>
        </span>
      </button>

      <div className="player__side">
        {stats && (
          <span className="player__swarm" title="Torrent swarm for this album">
            <Icon name="peers" size={16} />
            {plural(stats.numPeers, 'peer')}
            {stats.downloadSpeed > 1024 && <> · {formatSpeed(stats.downloadSpeed)}</>}
          </span>
        )}
        <div className="volume">
          <button type="button" className="icon-button" onClick={player.toggleMute} aria-label={state.muted ? 'Unmute' : 'Mute'}>
            <Icon name={volumeIcon} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.muted ? 0 : state.volume}
            onChange={e => player.setVolume(Number(e.target.value))}
            style={{ '--level': `${(state.muted ? 0 : state.volume) * 100}%` } as CSSProperties}
            aria-label="Volume"
          />
        </div>
      </div>
    </footer>
  )
}
