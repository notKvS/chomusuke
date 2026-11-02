import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { ProviderSettingsView, ProvidersResponse } from '../../../../shared/types'
import { StatusLine } from '../controls/StatusLine'
import './PluginSetupDialog.css'

interface Props {
  provider: ProviderSettingsView
  /** The plugin was switched on while it was missing details: switch it on for real once they're saved. */
  enableAfter: boolean
  onClose: () => void
  onSaved: (response: ProvidersResponse) => void
}

/**
 * The window a plugin gets to ask for its details (a login, an API key…), built from the options its manifest
 * declares: required ones are marked, secret ones are hidden and stored encrypted.
 */
export function PluginSetupDialog({ provider, enableAfter, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const options = provider.options ?? []
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(options.map(o => [o.key, o.secret ? '' : (o.value ?? (o.type === 'boolean' ? false : ''))]))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    let response = await window.chomusuke.setPluginOptions(provider.id, values)
    if (response.ok && enableAfter && !provider.enabled) {
      response = await window.chomusuke.setProviderEnabled(provider.id, true)
    }
    setSaving(false)
    if (response.ok) onSaved(response)
    else setError(response.error)
  }

  return (
    <dialog
      ref={dialog}
      className="plugin-dialog"
      aria-labelledby="plugin-dialog-title"
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
    >
      <form className="plugin-dialog__form" onSubmit={save}>
        <h2 id="plugin-dialog-title" className="plugin-dialog__title">
          {provider.needsSetup ? `Set up ${provider.name}` : provider.name}
        </h2>
        {provider.setup && <p className="plugin-dialog__note">{provider.setup}</p>}
        {options.map(option =>
          option.type === 'boolean' ? (
            <label key={option.key} className="plugin-dialog__check">
              <input
                type="checkbox"
                checked={values[option.key] === true}
                onChange={e => setValues(prev => ({ ...prev, [option.key]: e.target.checked }))}
              />
              <span>
                {option.label}
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ) : (
            <label key={option.key} className="plugin-dialog__field">
              <span>
                {option.label}
                {option.required && <em> (required)</em>}
              </span>
              <input
                type={option.secret ? 'password' : 'text'}
                value={values[option.key] as string}
                onChange={e => setValues(prev => ({ ...prev, [option.key]: e.target.value }))}
                placeholder={option.secret && option.hasValue ? 'Saved — leave blank to keep' : option.placeholder}
                required={option.required === true && !(option.secret && option.hasValue)}
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
              />
              {option.description && <small>{option.description}</small>}
            </label>
          )
        )}
        {options.some(o => o.secret) && (
          <p className="plugin-dialog__note">
            Passwords and keys are encrypted with your system's credential store and never shown again.
          </p>
        )}
        <div className="plugin-dialog__actions">
          <button type="submit" className="solid-button" disabled={saving}>
            {enableAfter ? 'Save and switch on' : 'Save'}
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          {error && <StatusLine status={{ kind: 'error', text: error }} />}
        </div>
      </form>
    </dialog>
  )
}
