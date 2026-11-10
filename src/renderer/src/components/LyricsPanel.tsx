import { type CSSProperties, useEffect, useRef } from 'react'
import type { Appearance } from '../theme/appearance'
import { useCoverTint } from '../useCoverTint'
import { activeLine, useLyrics } from '../useLyrics'
import type { Player } from '../usePlayer'
import './LyricsPanel.css'

/**
 * The words of the song that's playing, in a panel on the right side of the app (the mic button in the player bar
 * opens and closes it). Synced lyrics follow the song: the line being sung is lit and kept in the middle. Plain
 * lyrics just scroll. Its background takes its colours from the album cover; without one it keeps the theme's.
 */
export function LyricsPanel({ player, open, mode }: { player: Player; open: boolean; mode: Appearance['mode'] }) {
  const { track, state } = player
  const [lyrics, retry] = useLyrics(track, state.album, open)
  const tint = useCoverTint(state.album?.coverUrl, mode, open)
  const body = useRef<HTMLDivElement>(null)
  const active = lyrics.status === 'ready' && lyrics.lyrics ? activeLine(lyrics.lyrics, state.currentTime) : -1

  // Keep the line being sung in the middle of the panel (scrolling the panel only, never the page behind it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new active line is what moves the panel
  useEffect(() => {
    const container = body.current
    const line = container?.querySelector<HTMLElement>('[data-active="true"]')
    if (!container || !line) return
    container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' })
  }, [active])

  // A new song starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the track matters
  useEffect(() => {
    // A block, not an expression: newer browsers' scrollTo returns a Promise, which an effect must not return.
    body.current?.scrollTo({ top: 0 })
  }, [track?.id])

  if (!open || !track) return null
  const artist = track.artist ?? state.album?.artist
  return (
    <aside
      className={`lyrics ${tint ? 'has-tint' : ''}`}
      aria-label="Lyrics"
      style={tint ? ({ '--lyrics-from': tint.from, '--lyrics-to': tint.to } as CSSProperties) : undefined}
    >
      <header className="lyrics__head">
        <div className="lyrics__title">
          <h2>{track.title}</h2>
          {artist && <p>{artist}</p>}
        </div>
      </header>

      <div className="lyrics__body" ref={body}>
        {lyrics.status === 'loading' && <p className="lyrics__note">Looking for the lyrics…</p>}
        {lyrics.status === 'error' && (
          <div className="lyrics__note">
            <p>{lyrics.error}</p>
            <button type="button" className="pill-button" onClick={retry}>
              Try again
            </button>
          </div>
        )}
        {lyrics.status === 'ready' && !lyrics.lyrics && <p className="lyrics__note">No lyrics found for this song.</p>}
        {lyrics.status === 'ready' && lyrics.lyrics?.instrumental && (
          <p className="lyrics__note">This song is an instrumental.</p>
        )}
        {lyrics.status === 'ready' && lyrics.lyrics && !lyrics.lyrics.instrumental && (
          <ol className={`lyrics__lines ${lyrics.lyrics.synced ? 'is-synced' : ''}`}>
            {lyrics.lyrics.lines.map((line, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and never reorder
                key={index}
                className={`lyrics__line ${index === active ? 'is-active' : ''}`}
                data-active={index === active}
              >
                {line.text || ' '}
              </li>
            ))}
          </ol>
        )}
      </div>

      {lyrics.status === 'ready' && lyrics.lyrics && !lyrics.lyrics.instrumental && (
        <footer className="lyrics__foot">
          {lyrics.lyrics.synced ? 'Synced lyrics' : 'Lyrics'} from {lyrics.lyrics.source}
        </footer>
      )}
    </aside>
  )
}
