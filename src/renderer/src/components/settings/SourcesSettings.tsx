import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import type { PluginKind, ProviderSettingsView, ProvidersResponse, TorznabForm } from '../../../../shared/types'
import { type Status, StatusLine } from '../controls/StatusLine'
import { Switch } from '../controls/Switch'
import { Icon } from '../Icon'
import { PluginSetupDialog } from './PluginSetupDialog'
import './SourcesSettings.css'

const EMPTY_FORM: TorznabForm = { name: '', url: '', apiKey: '' }

/** The installed providers and charts, with what to do to them; shared by the Charts and Plugins tabs. */
function useProviders() {
  const [providers, setProviders] = useState<ProviderSettingsView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const reorder = async (ids: string[]) => apply(await window.chomusuke.reorderProviders(ids))

  const rowActions = {
    apply,
    onToggle: (provider: ProviderSettingsView) => void toggle(provider),
    onRemove: (provider: ProviderSettingsView) => void remove(provider)
  }
  return { providers: providers ?? [], error, apply, toggle, remove, reorder, rowActions }
}

/**
 * Drag-and-drop ordering for a list of rows. `onReorder` gets the new order of ids; without it the rows aren't
 * draggable. Each row also has a grip button that moves it with Alt+↑ / Alt+↓, for keyboard users.
 */
function useDragOrder(items: Array<{ id: string }>, onReorder?: (ids: string[]) => void) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const place = (id: string, index: number) => {
    const ids = items.map(item => item.id).filter(other => other !== id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    onReorder?.(ids)
  }
  const end = () => {
    setDragging(null)
    setOver(null)
  }

  const rowProps = (id: string) => {
    if (!onReorder) return {}
    return {
      draggable: true,
      className: `source-row-wrap ${dragging === id ? 'is-dragging' : ''} ${over === id ? 'is-drop-target' : ''}`,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
        setDragging(id)
      },
      onDragOver: (event: React.DragEvent) => {
        if (!dragging || dragging === id) return
        event.preventDefault()
        setOver(id)
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        if (dragging && dragging !== id)
          place(
            dragging,
            items.findIndex(item => item.id === id)
          )
        end()
      },
      onDragEnd: end
    }
  }

  const gripProps = (id: string) => {
    const index = items.findIndex(item => item.id === id)
    return {
      onKeyDown: (event: KeyboardEvent) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        place(id, index + (event.key === 'ArrowUp' ? -1 : 1))
      }
    }
  }
  return { rowProps, gripProps }
}

function ErrorLine({ error }: { error: string | null }) {
  return (
    error && (
      <p className="section-error">
        <Icon name="error" size={18} />
        {error}
      </p>
    )
  )
}

/** Charts: the data sources behind Explore. They only list music; plugins find and play it. */
export function ChartsSettings() {
  const { providers, error, apply, rowActions } = useProviders()
  const charts = providers.filter(p => p.type === 'plugin' && p.chart)
  return (
    <div className="sources">
      <p className="sources__lead">
        Charts are where Explore's lists come from: top songs and albums by country and genre. They only supply the
        list. To play an entry, Chomusuke searches your plugins for it.
      </p>
      <ErrorLine error={error} />
      <section className="shelf">
        <h2 className="shelf__title">Charts</h2>
        <PluginRows plugins={charts} {...rowActions} />
      </section>
      <InstallPlugins kind="chart" apply={apply} />
    </div>
  )
}

/** Plugins: where music is found and played from. */
export function PluginsSettings() {
  const { providers, error, apply, toggle, remove, reorder, rowActions } = useProviders()
  const [editing, setEditing] = useState<TorznabForm | null>(null)

  const indexers = providers.filter(p => p.type === 'torznab')
  // The built-in source and the plugins, in the order they are searched in.
  const plugins = providers.filter(p => p.builtIn || (p.type === 'plugin' && !p.chart))

  return (
    <div className="sources">
      <p className="sources__lead">
        Plugins are where Chomusuke finds music and plays it from. Search looks through all of them at once, and so does
        playing an entry from a chart. Everything currently plays over BitTorrent, and only the songs you play are
        downloaded.
      </p>
      <ErrorLine error={error} />

      <section className="shelf">
        <h2 className="shelf__title">Plugins</h2>
        <p className="sources__help">
          The Internet Archive collections come switched on; the tracker templates (The Pirate Bay, 1337x, Nyaa, Knaben,
          LimeTorrents) come switched off — turn one on and press Test to use it. Charts need at least one plugin that
          carries popular music.
        </p>
        <p className="sources__help">
          Drag a plugin by its handle (or press Alt+↑ / Alt+↓ on it) to change the order. Search results show up in this
          order, with the plugin at the top first.
        </p>
        <PluginRows plugins={plugins} {...rowActions} onReorder={ids => void reorder(ids)} />
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Torznab indexers</h2>
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

      <InstallPlugins kind="provider" apply={apply} />
    </div>
  )
}

interface PluginRowsProps {
  plugins: ProviderSettingsView[]
  apply: (response: ProvidersResponse) => boolean
  onToggle: (provider: ProviderSettingsView) => void
  onRemove: (provider: ProviderSettingsView) => void
  /** Rows can be dragged into a new order when this is given. */
  onReorder?: (ids: string[]) => void
}

/** Installed plugins (providers or charts), each with Test, a setup window for its options, and Remove. */
function PluginRows({ plugins, apply, onToggle, onRemove, onReorder }: PluginRowsProps) {
  const { rowProps, gripProps } = useDragOrder(plugins, onReorder)
  const [setup, setSetup] = useState<{ id: string; enableAfter: boolean } | null>(null)
  const [tests, setTests] = useState<Record<string, Status | undefined>>({})
  /** Plugins whose last test hit the site's bot check: they get a button that opens the site to pass it. */
  const [botChecked, setBotChecked] = useState<Record<string, boolean | undefined>>({})

  const test = async (provider: ProviderSettingsView) => {
    setTests(prev => ({ ...prev, [provider.id]: { kind: 'busy', text: 'Testing…' } }))
    const result = await window.chomusuke.testPlugin(provider.id)
    setBotChecked(prev => ({ ...prev, [provider.id]: !result.ok && result.challenge === true }))
    setTests(prev => ({
      ...prev,
      [provider.id]: result.ok ? { kind: 'ok', text: result.message } : { kind: 'error', text: result.error }
    }))
  }

  // Opens the site in a window; once the user closes it, the test runs again with the cookies it earned.
  const passBotCheck = async (provider: ProviderSettingsView) => {
    setTests(prev => ({
      ...prev,
      [provider.id]: { kind: 'busy', text: 'Pass the check in the window, then close it…' }
    }))
    const result = await window.chomusuke.passPluginBotCheck(provider.id)
    if (result.ok) await test(provider)
    else setTests(prev => ({ ...prev, [provider.id]: { kind: 'error', text: result.error } }))
  }

  // Switching a plugin on that is still missing details asks for them first.
  const toggle = (provider: ProviderSettingsView) => {
    if (!provider.enabled && provider.needsSetup) setSetup({ id: provider.id, enableAfter: true })
    else onToggle(provider)
  }

  const setting = plugins.find(p => p.id === setup?.id)
  return (
    <>
      {plugins.map(provider => (
        <div key={provider.id} {...rowProps(provider.id)}>
          <SourceRow
            provider={provider}
            leading={
              onReorder && (
                <button
                  type="button"
                  className="icon-button source-row__grip"
                  aria-label={`Move ${provider.name} (drag, or press Alt+Up or Alt+Down)`}
                  title="Drag to change the order"
                  {...gripProps(provider.id)}
                >
                  <Icon name="grip" size={20} />
                </button>
              )
            }
            description={
              provider.builtIn
                ? "Searches the Internet Archive's audio collections."
                : [
                    `v${provider.version}`,
                    provider.needsSetup && 'Needs your details (edit button)',
                    provider.hosts?.join(', ')
                  ]
                    .filter(Boolean)
                    .join(' • ')
            }
            note={provider.description}
            onToggle={() => toggle(provider)}
            onTest={provider.builtIn ? undefined : () => void test(provider)}
            onEdit={provider.options?.length ? () => setSetup({ id: provider.id, enableAfter: false }) : undefined}
            onRemove={provider.builtIn ? undefined : () => onRemove(provider)}
          />
          {tests[provider.id] && <StatusLine status={tests[provider.id] as Status} />}
          {botChecked[provider.id] && tests[provider.id]?.kind === 'error' && (
            <button type="button" className="pill-button" onClick={() => void passBotCheck(provider)}>
              <Icon name="link" size={18} />
              <span>Open site to pass the check</span>
            </button>
          )}
        </div>
      ))}
      {setting && setup && (
        <PluginSetupDialog
          key={setting.id}
          provider={setting}
          enableAfter={setup.enableAfter}
          onClose={() => setSetup(null)}
          onSaved={response => {
            if (apply(response)) setSetup(null)
          }}
        />
      )}
    </>
  )
}

/** Installs plugins from a repository manifest; each runs in a sandbox. */
function InstallPlugins({ kind, apply }: { kind: PluginKind; apply: (response: ProvidersResponse) => boolean }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  const importRepository = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'busy', text: 'Installing…' })
    const response = await window.chomusuke.importPlugins(url, kind)
    if (apply(response)) {
      setStatus({ kind: 'ok', text: 'Installed.' })
      setUrl('')
    } else if (!response.ok) setStatus({ kind: 'error', text: response.error })
  }

  return (
    <section className="shelf">
      <h2 className="shelf__title">{kind === 'chart' ? 'Add charts' : 'Add plugins'}</h2>
      <p className="sources__help">
        Paste the URL of a repository (a JSON manifest) to add {kind === 'chart' ? 'charts' : 'plugins'}. Each one runs
        in an isolated sandbox and can only reach the websites it declares. Only install repositories you trust.
      </p>
      <form className="import-form" onSubmit={importRepository}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.github.io/my-plugins/index.json"
          spellCheck={false}
          maxLength={2048}
          aria-label={kind === 'chart' ? 'Chart repository URL' : 'Plugin repository URL'}
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

interface RowProps {
  provider: ProviderSettingsView
  /** Shown before the icon, e.g. a drag handle */
  leading?: ReactNode
  description: string
  /** Optional longer text under the description, wrapped. */
  note?: string
  onToggle: () => void
  onTest?: () => void
  onEdit?: () => void
  onRemove?: () => void
}

function SourceRow({ provider, leading, description, note, onToggle, onTest, onEdit, onRemove }: RowProps) {
  return (
    <div className={`source-row ${provider.enabled ? '' : 'is-off'}`}>
      {leading}
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
