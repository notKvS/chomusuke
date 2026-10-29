import cryArt from '../../assets/mascot/chomusuke-cry.png'
import cryFace from '../../assets/mascot/chomusuke-cry-face.png'
import deadArt from '../../assets/mascot/chomusuke-dead.png'
import deadFace from '../../assets/mascot/chomusuke-dead-face.png'
import dizzyArt from '../../assets/mascot/chomusuke-dizzy.png'
import dizzyFace from '../../assets/mascot/chomusuke-dizzy-face.png'
import fireArt from '../../assets/mascot/chomusuke-fire.png'
import fireFace from '../../assets/mascot/chomusuke-fire-face.png'
import joyArt from '../../assets/mascot/chomusuke-joy.png'
import joyFace from '../../assets/mascot/chomusuke-joy-face.png'
import sleepyArt from '../../assets/mascot/chomusuke-sleepy.png'
import sleepyFace from '../../assets/mascot/chomusuke-sleepy-face.png'
import squintArt from '../../assets/mascot/chomusuke-squint.png'
import squintFace from '../../assets/mascot/chomusuke-squint-face.png'

/**
 * idle: wide open eyes · listening/happy: ^ ^ · sad: crying · sleep: closed · confused: spirals ·
 * dead: ✕ ✕ (not found / 404) · frustrated: > < (errors)
 */
export type ChomuMood = 'idle' | 'listening' | 'happy' | 'sad' | 'sleep' | 'confused' | 'dead' | 'frustrated'

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

const ART: Record<ChomuMood, [full: string, face: string]> = {
  idle: [fireArt, fireFace],
  listening: [joyArt, joyFace],
  happy: [joyArt, joyFace],
  sad: [cryArt, cryFace],
  sleep: [sleepyArt, sleepyFace],
  confused: [dizzyArt, dizzyFace],
  dead: [deadArt, deadFace],
  frustrated: [squintArt, squintFace]
}

const BADGES: Partial<Record<ChomuMood, string>> = {
  listening: '♪',
  confused: '?',
  sleep: 'zZ',
  frustrated: '#'
}

/**
 * Chomusuke, the mascot: the fiery cat with its fish, with a face for each mood (drawn from the same artwork),
 * plus CSS motion — floating with a flickering flame when awake, slow breathing when calm — and a mood badge.
 */
export function Chomu({ mood = 'idle', size = 160, className = '', dancing = false, headOnly = false, title }: Props) {
  const awake = mood === 'listening' || mood === 'happy'
  const badge = BADGES[mood]
  const [full, face] = ART[mood]
  return (
    <span
      className={`chomu chomu--${mood} ${awake ? 'is-awake' : 'is-calm'} ${dancing ? 'is-dancing' : ''} ${headOnly ? 'is-head' : ''} ${className}`}
      style={{ width: size, height: headOnly ? size : size * 1.19 }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <img className="chomu__art" src={headOnly ? face : full} alt="" draggable={false} />
      {badge && <span className="chomu__badge">{badge}</span>}
    </span>
  )
}
