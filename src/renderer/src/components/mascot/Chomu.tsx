import fireFace from '../../assets/mascot/chomusuke-fire-face.png'
import fireArt from '../../assets/mascot/chomusuke-fire.png'
import sleepFace from '../../assets/mascot/chomusuke-sleep-face.png'
import sleepArt from '../../assets/mascot/chomusuke-sleep.png'

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
 * Chomusuke, the mascot, using the supplied artwork: the fiery cat when awake/playing, the sleeping cat in
 * Megumin's hat otherwise. Animated with CSS (float, flame glow, breathing, dancing) plus mood badges.
 */
export function Chomu({ mood = 'idle', size = 160, className = '', dancing = false, headOnly = false, title }: Props) {
  const awake = mood === 'listening' || mood === 'happy'
  const badge = BADGES[mood]
  return (
    <span
      className={`chomu chomu--${mood} ${awake ? 'is-awake' : 'is-asleep'} ${dancing ? 'is-dancing' : ''} ${headOnly ? 'is-head' : ''} ${className}`}
      style={{ width: size, height: headOnly ? size : awake ? size * 1.19 : size * 0.62 }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <img
        className="chomu__art"
        src={headOnly ? (awake ? fireFace : sleepFace) : awake ? fireArt : sleepArt}
        alt=""
        draggable={false}
      />
      {badge && <span className="chomu__badge">{badge}</span>}
    </span>
  )
}
