import { useState, type FormEvent } from 'react'
import { looksLikeSource } from '../source'
import { Icon } from './Icon'
import { AnimatedLogo } from './mascot/AnimatedLogo'

interface Props {
  onSubmit: (input: string) => void
  onHome: () => void
  playing: boolean
}

export function TopBar({ onSubmit, onHome, playing }: Props) {
  const [value, setValue] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = value.trim()
    if (!input) return
    onSubmit(input)
    // Keep a search query visible like a search box does; links are one-shot.
    if (looksLikeSource(input)) setValue('')
  }

  return (
    <header className="topbar">
      <AnimatedLogo playing={playing} onHome={onHome} />
      <form className="source-form" onSubmit={submit}>
        <Icon name="search" className="source-form__icon" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Search songs, artists, albums… or paste a magnet  (=^･ω･^=)"
          spellCheck={false}
          autoComplete="off"
          maxLength={8192}
          aria-label="Search or paste a torrent link"
        />
        {value && (
          <button type="button" className="icon-button" onClick={() => setValue('')} aria-label="Clear">
            <Icon name="close" size={20} />
          </button>
        )}
      </form>
    </header>
  )
}
