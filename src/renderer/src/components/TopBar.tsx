import { useState, type FormEvent } from 'react'
import { Icon, Logo } from './Icon'

export function TopBar({ onSubmit, onHome }: { onSubmit: (source: string) => void; onHome: () => void }) {
  const [value, setValue] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="Chomusuke home">
        <Logo />
        <span>Chomusuke</span>
      </button>
      <form className="source-form" onSubmit={submit}>
        <Icon name="link" className="source-form__icon" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Paste a magnet link, info hash or .torrent URL"
          spellCheck={false}
          autoComplete="off"
          aria-label="Torrent link"
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
