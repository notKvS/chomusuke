import { type ReactNode, useState } from 'react'
import { Chomu, type ChomuMood } from './Chomu'

/**
 * Character stickers for empty and error states, each with a short quirky line.
 *
 * Artwork: drop PNG/WebP/GIF files into `src/renderer/src/assets/stickers/`, named `<character>.png` (e.g.
 * `megumin.png`) or `<character>-<scene>.png` for a scene-specific pose (e.g. `aqua-search-empty.png`). Missing
 * stickers fall back to Chomusuke, so the app works with any subset — or none.
 */

type Character = 'aqua' | 'megumin' | 'kazuma' | 'darkness'

export type Scene =
  | 'search-empty'
  | 'search-error'
  | 'no-sources'
  | 'album-error'
  | 'liked-empty'
  | 'disliked-empty'
  | 'playlist-empty'
  | 'library-empty'

const NAMES: Record<Character, string> = { aqua: 'Aqua', megumin: 'Megumin', kazuma: 'Kazuma', darkness: 'Darkness' }

const SCENES: Record<Scene, { character: Character; mood: ChomuMood; lines: string[] }> = {
  'search-empty': {
    character: 'aqua',
    mood: 'dead',
    lines: [
      'Zero results?! Impossible. A goddess’s search is never wrong — the internet must be hiding it from me.',
      'Nothing here… try fewer words. And maybe a small offering to Aqua while you’re at it.'
    ]
  },
  'search-error': {
    character: 'kazuma',
    mood: 'frustrated',
    lines: [
      'Of course it broke. Nothing in this world works on the first try.',
      'A source tripped over its own feet. Hit retry before it notices.'
    ]
  },
  'no-sources': {
    character: 'kazuma',
    mood: 'sleep',
    lines: ['Every source is switched off. Even I can’t steal music out of thin air.']
  },
  'album-error': {
    character: 'megumin',
    mood: 'dead',
    lines: [
      'This torrent refused to load. If only I were allowed to blow it up instead…',
      'A dud! It fizzled before the fun part. Let’s pick another one — preferably one that goes boom.'
    ]
  },
  'liked-empty': {
    character: 'darkness',
    mood: 'sad',
    lines: ['Not a single liked song… such cold neglect. I don’t hate it. But please, thumbs-up something.']
  },
  'disliked-empty': {
    character: 'kazuma',
    mood: 'happy',
    lines: ['You don’t dislike anything yet? Give it a few albums.']
  },
  'playlist-empty': {
    character: 'megumin',
    mood: 'happy',
    lines: ['An empty playlist is a silent battlefield. Add some songs and let’s make it roar!']
  },
  'library-empty': {
    character: 'aqua',
    mood: 'sleep',
    lines: ['Nothing saved yet. Save an album offline and I’ll guard it with my life. Probably.']
  }
}

const files = import.meta.glob<string>('../../assets/stickers/*.{png,webp,gif}', {
  eager: true,
  import: 'default'
})
/** Sticker URLs by file name without extension, e.g. "megumin" or "aqua-search-empty". */
const STICKERS = new Map(
  Object.entries(files).map(([file, url]) => [
    file
      .split('/')
      .pop()
      ?.replace(/\.[a-z]+$/i, '')
      .toLowerCase() ?? '',
    url
  ])
)

export function Sticker({ scene, size = 180, children }: { scene: Scene; size?: number; children?: ReactNode }) {
  const { character, mood, lines } = SCENES[scene]
  // One line per visit, not a new one on every render.
  const [line] = useState(() => lines[Math.floor(Math.random() * lines.length)])
  const art = STICKERS.get(`${character}-${scene}`) ?? STICKERS.get(character)

  return (
    <div className={`sticker sticker--${character}`}>
      <div className="sticker__stage">
        {art ? (
          <img className="sticker__art" src={art} alt={NAMES[character]} style={{ height: size }} draggable={false} />
        ) : (
          <Chomu mood={mood} size={size * 0.8} />
        )}
        <figure className="sticker__bubble">
          <figcaption className="sticker__name">{NAMES[character]}</figcaption>
          <blockquote>{line}</blockquote>
        </figure>
      </div>
      {children}
    </div>
  )
}
