import fireArt from '../../assets/mascot/chomusuke-fire.png'
import fireFace from '../../assets/mascot/chomusuke-fire-face.png'

export type ChomuMood = 'idle' | 'listening' | 'happy' | 'sad' | 'sleep' | 'confused'

interface Props {
  mood?: ChomuMood
  size?: number
  className?: string
  /** Bob along to the music */
  dancing?: boolean
  /** Crop to the face (for the logo and player) */
  headOnly?: boolean
  title?: string
}

const BADGES: Partial<Record<ChomuMood, string>> = {
  listening: '♪',
  sad: '💧',
  confused: '?',
  sleep: 'zZ'
}

/**
 * Chomusuke, the mascot: one artwork (the fiery cat with its fish), with the mood shown through CSS motion —
 * floating with a flickering flame when awake, slow breathing when calm — plus a mood badge.
 */
export function Chomu({ mood = 'idle', size = 160, className = '', dancing = false, headOnly = false, title }: Props) {
  const awake = mood === 'listening' || mood === 'happy'
  const badge = BADGES[mood]
  return (
    <span
      className={`chomu chomu--${mood} ${awake ? 'is-awake' : 'is-calm'} ${dancing ? 'is-dancing' : ''} ${headOnly ? 'is-head' : ''} ${className}`}
      style={{ width: size, height: headOnly ? size : size * 1.19 }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <img className="chomu__art" src={headOnly ? fireFace : fireArt} alt="" draggable={false} />
      {badge && <span className="chomu__badge">{badge}</span>}
    </span>
  )
}
