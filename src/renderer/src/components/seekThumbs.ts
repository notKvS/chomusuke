import joyFace from '../assets/mascot/chomusuke-joy-face.png'
import sleepyFace from '../assets/mascot/chomusuke-sleepy-face.png'
import type { Appearance } from '../theme/appearance'

/**
 * The pictures that can ride the player's seek bar (the "Seek bar" appearance setting). To add one: put
 * `<id>.gif|webp|png` in `src/renderer/src/assets/seek/`, add the id to SEEK_THUMBS (theme/appearance.ts) and a
 * label here. 'chomusuke' and 'dot' are built in (the face changes with play/pause; the dot has no picture).
 */
export type SeekThumb = Appearance['seekThumb']

export const SEEK_LABELS: Record<SeekThumb, string> = {
  blindfold: 'Blindfold',
  redhead: 'Red hair',
  darkhair: 'Dark hair',
  pinkhair: 'Pink hair',
  duck: 'Sword duck',
  runner: 'Yellow runner',
  hero: 'Night hero',
  chomusuke: 'Chomusuke',
  dot: 'Dot'
}

const files = import.meta.glob<string>('../assets/seek/*.{png,webp,gif}', { eager: true, import: 'default' })
const art = new Map(
  Object.entries(files).map(([file, url]) => [
    file
      .split('/')
      .pop()
      ?.replace(/\.[a-z]+$/i, '')
      .toLowerCase() ?? '',
    url
  ])
)

/** The picture for a choice; none for the plain dot. A missing file falls back to Chomusuke. */
export function seekPicture(choice: SeekThumb, playing = true): string | undefined {
  if (choice === 'dot') return undefined
  const face = playing ? joyFace : sleepyFace
  return choice === 'chomusuke' ? face : (art.get(choice) ?? face)
}
