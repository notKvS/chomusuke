import type { PluginKind, ProvidersResponse, TestResponse } from '../../shared/types.ts'
import { FetchError, fetchJson, fetchText } from '../http.ts'
import { logger } from '../log.ts'
import { isBotCheckMessage } from '../plugin-host/challenge.ts'
import { forKind, PluginError, type PluginManifest, parseRepository } from '../plugin-host/manifest.ts'
import { testPlugin } from '../plugin-host/provider.ts'
import { buildProviders } from '../providers/index.ts'
import { type ProviderSettingsStore, SettingsError, validateRepositoryUrl } from '../providers/settings.ts'
import { TorznabError, testTorznab } from '../providers/torznab.ts'
import type { IpcDeps } from './deps.ts'
import { handle } from './guard.ts'

const log = logger('sources')

const REPOSITORY_MAX_BYTES = 512 * 1024
const PLUGIN_CODE_MAX_BYTES = 2 * 1024 * 1024
const PLUGIN_FETCH_TIMEOUT_MS = 20_000

const pluginKind = (value: unknown): PluginKind => {
  if (value === 'provider' || value === 'chart') return value
  throw new SettingsError('Unknown plugin type.')
}

/** Downloads a repository manifest and the code of every plugin of this kind that it lists. */
async function downloadRepository(
  rawUrl: unknown,
  kind: PluginKind
): Promise<{ url: string; installs: Array<{ manifest: PluginManifest; code: string }> }> {
  const { url, privateHttp } = validateRepositoryUrl(rawUrl)
  const origin = new URL(url).origin
  const policy = {
    timeoutMs: PLUGIN_FETCH_TIMEOUT_MS,
    // Plain http only for a repository on your own network, and only on its own origin.
    allowHttp: (target: URL) => privateHttp && target.origin === origin
  }
  try {
    const manifests = parseRepository(
      await fetchJson(url, { ...policy, maxBytes: REPOSITORY_MAX_BYTES }),
      url,
      privateHttp
    )
    const installs = await Promise.all(
      manifests.map(async manifest => ({
        manifest,
        code: await fetchText(manifest.codeUrl, {
          ...policy,
          maxBytes: PLUGIN_CODE_MAX_BYTES,
          accept: 'text/javascript, */*;q=0.5'
        })
      }))
    )
    return { url, installs: forKind(installs, kind) }
  } catch (err) {
    if (err instanceof PluginError || err instanceof SettingsError) throw new SettingsError(err.message)
    if (err instanceof FetchError)
      throw new SettingsError(
        `Couldn’t download the repository (${err.kind === 'status' ? `HTTP ${err.status}` : err.kind}).`
      )
    throw err
  }
}

/** Runs a settings change and answers with the updated list of sources, or a message to show. */
async function settingsResult(work: () => Promise<unknown>, store: ProviderSettingsStore): Promise<ProvidersResponse> {
  try {
    await work()
    return { ok: true, providers: store.list() }
  } catch (err) {
    if (err instanceof SettingsError) return { ok: false, error: err.message }
    log.error('saving failed:', err)
    return { ok: false, error: 'Couldn’t save your sources.' }
  }
}

/** Managing sources: Torznab indexers, plugins installed from a repository, and testing either. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, registry, settings, pluginRuntime, disposeUnusedHosts, mainWindow } = deps
  const rebuildProviders = () => {
    const enabled = settings.enabled()
    registry.setProviders(
      buildProviders(enabled, {
        pluginRuntime,
        findRelease: (wanted, signal) => registry.findRelease(wanted, signal)
      })
    )
    disposeUnusedHosts(new Set(enabled.flatMap(p => (p.type === 'plugin' ? [p.manifest.id] : []))))
  }
  rebuildProviders()

  handle('providers:list', (event): ProvidersResponse => {
    assertTrustedSender(event)
    return { ok: true, providers: settings.list() }
  })

  handle('providers:save-torznab', (event, form: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.saveTorznab(form)
      rebuildProviders()
    }, settings)
  })

  handle('providers:set-enabled', (event, id: unknown, enabled: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setEnabled(id, enabled)
      rebuildProviders()
    }, settings)
  })

  handle('providers:remove', (event, id: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.remove(id)
      rebuildProviders()
    }, settings)
  })

  handle('plugins:import', (event, repositoryUrl: unknown, kind: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      const wanted = pluginKind(kind)
      const { url, installs } = await downloadRepository(repositoryUrl, wanted)
      await settings.installPlugins(url, installs)
      rebuildProviders()
    }, settings)
  })

  handle('plugins:set-options', (event, id: unknown, values: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setPluginOptions(id, values)
      rebuildProviders()
    }, settings)
  })

  handle('plugins:test', async (event, id: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.pluginConfig(id)
      const runtime = pluginRuntime(config.manifest, config.code, config.codeSha256)
      return { ok: true, message: await testPlugin(config.manifest, runtime, config.options) }
    } catch (err) {
      if (err instanceof PluginError)
        return { ok: false, error: err.message, challenge: isBotCheckMessage(err.message) }
      if (err instanceof SettingsError) return { ok: false, error: err.message }
      log.error('plugin test failed:', err)
      return { ok: false, error: 'The plugin isn’t working.' }
    }
  })

  // The site answered a plugin with a bot check: let the user pass it in a window, then the plugin reuses the cookies.
  handle('plugins:pass-bot-check', async (event, id: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const { manifest, code, codeSha256, options } = settings.pluginConfig(id)
      const mirror = typeof options.mirror === 'string' ? options.mirror.trim().toLowerCase() : ''
      const host = manifest.hosts.includes(mirror) ? mirror : manifest.hosts.find(h => !h.startsWith('*.'))
      if (!host) return { ok: false, error: `${manifest.name} has no site to open.` }
      const kept = await pluginRuntime(manifest, code, codeSha256).passBotCheck(`https://${host}/`, mainWindow())
      return kept > 0
        ? { ok: true, message: 'Done. Test the source again.' }
        : { ok: false, error: 'The site gave nothing to keep. Open it again and wait for the page to load first.' }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof PluginError) return { ok: false, error: err.message }
      log.error('bot check window failed:', err)
      return { ok: false, error: 'Couldn’t open the site.' }
    }
  })

  handle('providers:test-torznab', async (event, form: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.resolveTorznab(form)
      return { ok: true, message: await testTorznab({ ...config, id: config.id ?? 'torznab-test' }) }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof TorznabError) return { ok: false, error: err.message }
      log.error('Torznab test failed:', err)
      return { ok: false, error: 'Couldn’t reach that indexer.' }
    }
  })
}
