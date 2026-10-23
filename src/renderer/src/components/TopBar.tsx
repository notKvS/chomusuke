import { useState, type FormEvent } from 'react'
import { looksLikeSource } from '../source'
import { Icon, Logo } from './Icon'

export function TopBar({ onSubmit, onHome }: { onSubmit: (input: string) => void; onHome: () => void }) {
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
      <button type="button" className="brand" onClick={onHome} aria-label="Chomusuke home">
        <Logo />
        <span>Chomusuke</span>
      </button>
      <form className="source-form" onSubmit={submit}>
        <Icon name="search" className="source-form__icon" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Search songs, albums, artists — or paste a magnet link"
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
