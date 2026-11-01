import { type FormEvent, useEffect, useState } from 'react'
import type { ProviderSettingsView, ProvidersResponse, TorznabForm } from '../../../../shared/types'
import { type Status, StatusLine } from '../controls/StatusLine'
import { Switch } from '../controls/Switch'
import { Icon } from '../Icon'
import './SourcesSettings.css'

const EMPTY_FORM: TorznabForm = { name: '', url: '', apiKey: '' }

/** Providers (the Internet Archive, Torznab indexers, provider plugins), charts, and installing plugins. */
export function SourcesSettings() {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; apply only calls state setters
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
  const plugins = providers?.filter(p => p.type === 'plugin') ?? []
  const rowActions = {
    apply,
    onToggle: (provider: ProviderSettingsView) => void toggle(provider),
    onRemove: (provider: ProviderSettingsView) => void remove(provider)
  }

  return (
    <div className="sources">
      <p className="sources__lead">
        Providers are where Chomusuke finds music: every result plays over BitTorrent, and only the songs you play are
        downloaded. Charts fill Explore with what's popular and play each entry by searching your providers.
      </p>
      {error && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      <section className="shelf">
        <h2 className="shelf__title">Providers</h2>
        <p className="sources__help">
          Searched when you look for music, and when you play something from a chart. The Internet Archive collections
          come switched on; the tracker templates (The Pirate Bay, 1337x, Nyaa, Knaben, LimeTorrents) come switched off
          — turn one on and press Test to use it. Charts need at least one provider that carries popular music.
        </p>
        {builtIn.map(provider => (
          <SourceRow
            key={provider.id}
            provider={provider}
            description="Searches the Internet Archive's audio collections."
            onToggle={() => void toggle(provider)}
          />
        ))}
        <PluginRows plugins={plugins.filter(p => !p.chart)} {...rowActions} />
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Torrent indexers</h2>
        <p className="sources__help">
          Connect any indexer that speaks <strong>Torznab</strong>, the standard torrent search API, as a provider.
          Chomusuke searches the audio categories of whatever trackers you've set up there. Copy the Torznab feed URL
          and API key from the indexer's settings, for example <code>http://localhost:9117/api/torznab</code>.
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

      <section className="shelf">
        <h2 className="shelf__title">Charts</h2>
        <p className="sources__help">
          Top albums and songs for Explore. Each entry plays by searching your providers for it.
        </p>
        <PluginRows plugins={plugins.filter(p => p.chart)} {...rowActions} />
      </section>

      <InstallPlugins apply={apply} />
    </div>
  )
}

interface PluginRowsProps {
  plugins: ProviderSettingsView[]
  apply: (response: ProvidersResponse) => boolean
  onToggle: (provider: ProviderSettingsView) => void
  onRemove: (provider: ProviderSettingsView) => void
}

/** Installed plugins (providers or charts), each with Test, options and Remove. */
function PluginRows({ plugins, apply, onToggle, onRemove }: PluginRowsProps) {
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, Status | undefined>>({})

  const test = async (provider: ProviderSettingsView) => {
    setTests(prev => ({ ...prev, [provider.id]: { kind: 'busy', text: 'Testing…' } }))
    const result = await window.chomusuke.testPlugin(provider.id)
    setTests(prev => ({
      ...prev,
      [provider.id]: result.ok ? { kind: 'ok', text: result.message } : { kind: 'error', text: result.error }
    }))
  }

  return plugins.map(provider => (
    <div key={provider.id}>
      <SourceRow
        provider={provider}
        description={[`v${provider.version}`, provider.hosts?.join(', ')].filter(Boolean).join(' • ')}
        note={provider.description}
        onToggle={() => onToggle(provider)}
        onTest={() => void test(provider)}
        onEdit={
          provider.options?.length ? () => setConfiguring(configuring === provider.id ? null : provider.id) : undefined
        }
        onRemove={() => onRemove(provider)}
      />
      {tests[provider.id] && <StatusLine status={tests[provider.id] as Status} />}
      {configuring === provider.id && (
        <PluginOptionsForm
          provider={provider}
          onDone={response => {
            if (apply(response)) setConfiguring(null)
          }}
        />
      )}
    </div>
  ))
}

/** Installs plugins from a repository manifest; each runs in a sandbox. */
function InstallPlugins({ apply }: { apply: (response: ProvidersResponse) => boolean }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  const importRepository = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'busy', text: 'Installing…' })
    const response = await window.chomusuke.importPlugins(url)
    if (apply(response)) {
      setStatus({ kind: 'ok', text: 'Installed.' })
      setUrl('')
    } else if (!response.ok) setStatus({ kind: 'error', text: response.error })
  }

  return (
    <section className="shelf">
      <h2 className="shelf__title">Install plugins</h2>
      <p className="sources__help">
        Plugins add providers or charts. Paste the URL of a plugin repository (a JSON manifest). Each plugin runs in an
        isolated sandbox and can only reach the websites it declares. Only install repositories you trust.
      </p>
      <form className="import-form" onSubmit={importRepository}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.github.io/my-plugins/index.json"
          spellCheck={false}
          maxLength={2048}
          aria-label="Plugin repository URL"
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

function PluginOptionsForm({
  provider,
  onDone
}: {
  provider: ProviderSettingsView
  onDone: (r: ProvidersResponse) => void
}) {
  const options = provider.options ?? []
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(options.map(o => [o.key, o.secret ? '' : (o.value ?? (o.type === 'boolean' ? false : ''))]))
  )
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const response = await window.chomusuke.setPluginOptions(provider.id, values)
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
        <Icon name={provider.builtIn ? 'music' : provider.type === 'plugin' ? 'plugin' : 'download'} />
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
      <Switch
        checked={provider.enabled}
        label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`}
        onChange={onToggle}
      />
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
  const [status, setStatus] = useState<Status | null>(null)
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
        <input
          value={form.name}
          onChange={e => set('name')(e.target.value)}
          placeholder="My indexer"
          maxLength={60}
          required
        />
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
        {status && <StatusLine status={status} />}
      </div>
    </form>
  )
}
