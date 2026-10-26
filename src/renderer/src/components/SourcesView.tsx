import { useEffect, useState, type FormEvent } from 'react'
import type { ProviderSettingsView, ProvidersResponse, TorznabForm } from '../../../shared/types'
import { Icon } from './Icon'

type Status = { kind: 'busy' | 'ok' | 'error'; text: string } | null

const EMPTY_FORM: TorznabForm = { name: '', url: '', apiKey: '' }

/** Settings page for where search looks: the built-in Internet Archive plus any Torznab indexers. */
export function SourcesView() {
  const [providers, setProviders] = useState<ProviderSettingsView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TorznabForm | null>(null)

  const apply = (response: ProvidersResponse): boolean => {
    if (!response.ok) {
      setError(response.error)
      return false
    }
    setProviders(response.providers)
    setError(null)
    return true
  }

  useEffect(() => {
    void window.chomusuke.listProviders().then(apply)
  }, [])

  const toggle = async (provider: ProviderSettingsView) =>
    apply(await window.chomusuke.setProviderEnabled(provider.id, !provider.enabled))

  const remove = async (provider: ProviderSettingsView) => {
    if (!window.confirm(`Remove ${provider.name}? Its saved API key is deleted too.`)) return
    apply(await window.chomusuke.removeProvider(provider.id))
  }

  const builtIn = providers?.filter(p => p.builtIn) ?? []
  const indexers = providers?.filter(p => p.type === 'torznab') ?? []
  const extensions = providers?.filter(p => p.type === 'extension') ?? []

  return (
    <div className="page sources">
      <h1 className="search__title">Sources</h1>
      <p className="sources__lead">
        Where Chomusuke looks when you search. Every result plays over BitTorrent, and only the songs you play are
        downloaded.
      </p>
      {error && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      <section className="shelf">
        <h2 className="shelf__title">Built in</h2>
        {builtIn.map(provider => (
          <SourceRow
            key={provider.id}
            provider={provider}
            description="Searches the Internet Archive's audio collections."
            onToggle={() => void toggle(provider)}
          />
        ))}
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Torrent indexers</h2>
        <p className="sources__help">
          Connect any indexer that speaks <strong>Torznab</strong>, the standard torrent search API. Chomusuke searches
          the audio categories of whatever trackers you've set up there. Copy the Torznab feed URL and API key from the
          indexer's settings, for example <code>http://localhost:9117/api/torznab</code>.
        </p>

        {indexers.map(provider => (
          <SourceRow
            key={provider.id}
            provider={provider}
            description={provider.url ?? ''}
            onToggle={() => void toggle(provider)}
            onEdit={() => setEditing({ id: provider.id, name: provider.name, url: provider.url ?? '', apiKey: '' })}
            onRemove={() => void remove(provider)}
          />
        ))}

        {editing ? (
          <TorznabEditor
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={response => {
              if (apply(response)) setEditing(null)
            }}
          />
        ) : (
          <button type="button" className="pill-button sources__add" onClick={() => setEditing(EMPTY_FORM)}>
            <Icon name="add" size={20} />
            <span>Add indexer</span>
          </button>
        )}
      </section>

      <ExtensionsSection
        extensions={extensions}
        apply={apply}
        onToggle={provider => void toggle(provider)}
        onRemove={provider => void remove(provider)}
      />
    </div>
  )
}

interface ExtensionsProps {
  extensions: ProviderSettingsView[]
  apply: (response: ProvidersResponse) => boolean
  onToggle: (provider: ProviderSettingsView) => void
  onRemove: (provider: ProviderSettingsView) => void
}

/** Extensions: sources installed from a repository manifest, each run in a sandbox. */
function ExtensionsSection({ extensions, apply, onToggle, onRemove }: ExtensionsProps) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, Status>>({})

  const importRepository = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'busy', text: 'Installing…' })
    const response = await window.chomusuke.importExtensions(url)
    if (apply(response)) {
      setStatus({ kind: 'ok', text: 'Installed.' })
      setUrl('')
    } else if (!response.ok) setStatus({ kind: 'error', text: response.error })
  }

  const test = async (provider: ProviderSettingsView) => {
    setTests(prev => ({ ...prev, [provider.id]: { kind: 'busy', text: 'Testing…' } }))
    const result = await window.chomusuke.testExtension(provider.id)
    setTests(prev => ({
      ...prev,
      [provider.id]: result.ok ? { kind: 'ok', text: result.message } : { kind: 'error', text: result.error }
    }))
  }

  return (
    <section className="shelf">
      <h2 className="shelf__title">Extensions</h2>
      <p className="sources__help">
        Extensions add sources. The Internet Archive collections come switched on; the tracker templates
        (The Pirate Bay, 1337x, Nyaa, Knaben, LimeTorrents) come switched off — turn one on and press Test to use it.
        To add more, paste the URL of an extension repository (a JSON manifest). Each extension runs in an isolated
        sandbox and can only reach the websites it declares. Only install repositories you trust.
      </p>

      {extensions.map(provider => (
        <div key={provider.id}>
          <SourceRow
            provider={provider}
            description={`v${provider.version} • ${provider.hosts?.join(', ')}`}
            note={provider.description}
            onToggle={() => onToggle(provider)}
            onTest={() => void test(provider)}
            onEdit={provider.options?.length ? () => setConfiguring(configuring === provider.id ? null : provider.id) : undefined}
            onRemove={() => onRemove(provider)}
          />
          {tests[provider.id] && <StatusLine status={tests[provider.id] as NonNullable<Status>} />}
          {configuring === provider.id && (
            <ExtensionOptionsForm
              provider={provider}
              onDone={response => {
                if (apply(response)) setConfiguring(null)
              }}
            />
          )}
        </div>
      ))}

      <form className="import-form" onSubmit={importRepository}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.github.io/my-extensions/index.json"
          spellCheck={false}
          maxLength={2048}
          aria-label="Extension repository URL"
          required
        />
        <button type="submit" className="solid-button" disabled={status?.kind === 'busy'}>
          Install
        </button>
      </form>
      {status && <StatusLine status={status} />}
    </section>
  )
}

function StatusLine({ status }: { status: NonNullable<Status> }) {
  return (
    <span className={`torznab-form__status is-${status.kind}`} role="status">
      {status.kind === 'ok' && <Icon name="check" size={18} />}
      {status.kind === 'error' && <Icon name="error" size={18} />}
      {status.text}
    </span>
  )
}

function ExtensionOptionsForm({ provider, onDone }: { provider: ProviderSettingsView; onDone: (r: ProvidersResponse) => void }) {
  const options = provider.options ?? []
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(options.map(o => [o.key, o.secret ? '' : (o.value ?? (o.type === 'boolean' ? false : ''))]))
  )
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const response = await window.chomusuke.setExtensionOptions(provider.id, values)
    if (!response.ok) setError(response.error)
    onDone(response)
  }

  return (
    <form className="torznab-form" onSubmit={save}>
      {options.map(option =>
        option.type === 'boolean' ? (
          <label key={option.key} className="checkbox">
            <input
              type="checkbox"
              checked={values[option.key] === true}
              onChange={e => setValues(prev => ({ ...prev, [option.key]: e.target.checked }))}
            />
            <span>{option.label}</span>
          </label>
        ) : (
          <label key={option.key}>
            <span>{option.label}</span>
            <input
              type={option.secret ? 'password' : 'text'}
              value={values[option.key] as string}
              onChange={e => setValues(prev => ({ ...prev, [option.key]: e.target.value }))}
              placeholder={option.secret && option.hasValue ? 'Saved — leave blank to keep' : option.description}
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
            />
          </label>
        )
      )}
      <div className="torznab-form__actions">
        <button type="submit" className="solid-button">
          Save
        </button>
        {error && <StatusLine status={{ kind: 'error', text: error }} />}
      </div>
    </form>
  )
}

interface RowProps {
  provider: ProviderSettingsView
  description: string
  /** Optional longer text under the description, wrapped. */
  note?: string
  onToggle: () => void
  onTest?: () => void
  onEdit?: () => void
  onRemove?: () => void
}

function SourceRow({ provider, description, note, onToggle, onTest, onEdit, onRemove }: RowProps) {
  return (
    <div className={`source-row ${provider.enabled ? '' : 'is-off'}`}>
      <span className="source-row__icon">
        <Icon name={provider.builtIn ? 'music' : provider.type === 'extension' ? 'extension' : 'download'} />
      </span>
      <span className="source-row__text">
        <span className="source-row__name">{provider.name}</span>
        <span className="source-row__sub">{description}</span>
        {note && <span className="source-row__note">{note}</span>}
      </span>
      {onTest && (
        <button type="button" className="ghost-button" onClick={onTest}>
          Test
        </button>
      )}
      {onEdit && (
        <button type="button" className="icon-button" onClick={onEdit} aria-label={`Edit ${provider.name}`}>
          <Icon name="edit" size={20} />
        </button>
      )}
      {onRemove && (
        <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${provider.name}`}>
          <Icon name="delete" size={20} />
        </button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={provider.enabled}
        aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`}
        className="switch"
        onClick={onToggle}
      >
        <span className="switch__knob" />
      </button>
    </div>
  )
}

interface EditorProps {
  initial: TorznabForm
  onCancel: () => void
  onSaved: (response: ProvidersResponse) => void
}

function TorznabEditor({ initial, onCancel, onSaved }: EditorProps) {
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<Status>(null)
  const editing = Boolean(initial.id)
  const set = (field: keyof TorznabForm) => (value: string) => setForm(prev => ({ ...prev, [field]: value }))

  const test = async () => {
    setStatus({ kind: 'busy', text: 'Testing…' })
    const result = await window.chomusuke.testTorznab(form)
    setStatus(result.ok ? { kind: 'ok', text: result.message } : { kind: 'error', text: result.error })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'busy', text: 'Saving…' })
    const response = await window.chomusuke.saveTorznab(form)
    if (!response.ok) setStatus({ kind: 'error', text: response.error })
    onSaved(response)
  }

  return (
    <form className="torznab-form" onSubmit={save}>
      <label>
        <span>Name</span>
        <input value={form.name} onChange={e => set('name')(e.target.value)} placeholder="My indexer" maxLength={60} required />
      </label>
      <label>
        <span>Torznab URL</span>
        <input
          value={form.url}
          onChange={e => set('url')(e.target.value)}
          placeholder="http://localhost:9117/api/v2.0/indexers/all/results/torznab/api"
          spellCheck={false}
          maxLength={2048}
          required
        />
      </label>
      <label>
        <span>API key</span>
        <input
          type="password"
          value={form.apiKey}
          onChange={e => set('apiKey')(e.target.value)}
          placeholder={editing ? 'Leave blank to keep the saved key' : 'From the indexer’s settings'}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          required={!editing}
        />
      </label>
      <p className="torznab-form__note">
        The key is encrypted with your system’s credential store and never shown again. Plain http is only allowed for
        indexers on your own network, and sends the key unencrypted over it.
      </p>
      <div className="torznab-form__actions">
        <button type="button" className="ghost-button" onClick={() => void test()} disabled={status?.kind === 'busy'}>
          Test connection
        </button>
        <button type="submit" className="solid-button" disabled={status?.kind === 'busy'}>
          {editing ? 'Save changes' : 'Add indexer'}
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
        {status && (
          <span className={`torznab-form__status is-${status.kind}`} role="status">
            {status.kind === 'ok' && <Icon name="check" size={18} />}
            {status.kind === 'error' && <Icon name="error" size={18} />}
            {status.text}
          </span>
        )}
      </div>
    </form>
  )
}
