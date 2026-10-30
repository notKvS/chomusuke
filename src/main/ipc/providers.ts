import { ipcMain } from 'electron'
import type { ProvidersResponse, TestResponse } from '../../shared/types.ts'
import { ExtensionError, type ExtensionManifest, parseRepository } from '../extension-host/manifest.ts'
import { testExtension } from '../extension-host/provider.ts'
import { FetchError, fetchJson, fetchText } from '../http.ts'
import { buildProviders } from '../providers/index.ts'
import { type ProviderSettingsStore, SettingsError, validateRepositoryUrl } from '../providers/settings.ts'
import { TorznabError, testTorznab } from '../providers/torznab.ts'
import type { IpcDeps } from './deps.ts'

const REPOSITORY_MAX_BYTES = 512 * 1024
const EXTENSION_CODE_MAX_BYTES = 2 * 1024 * 1024
const EXTENSION_FETCH_TIMEOUT_MS = 20_000

/** Downloads a repository manifest and every extension's code it lists. */
async function downloadRepository(
  rawUrl: unknown
): Promise<{ url: string; installs: Array<{ manifest: ExtensionManifest; code: string }> }> {
  const { url, privateHttp } = validateRepositoryUrl(rawUrl)
  const origin = new URL(url).origin
  const policy = {
    timeoutMs: EXTENSION_FETCH_TIMEOUT_MS,
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
          maxBytes: EXTENSION_CODE_MAX_BYTES,
          accept: 'text/javascript, */*;q=0.5'
        })
      }))
    )
    return { url, installs }
  } catch (err) {
    if (err instanceof ExtensionError || err instanceof SettingsError) throw new SettingsError(err.message)
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
    console.error('[settings] failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Couldn’t save your sources.' }
  }
}

/** Managing sources: Torznab indexers, extensions installed from a repository, and testing either. */
export function register(deps: IpcDeps): void {
  const { assertTrustedSender, registry, settings, extensionRuntime, disposeUnusedHosts } = deps
  const rebuildProviders = () => {
    const enabled = settings.enabled()
    registry.setProviders(buildProviders(enabled, { extensionRuntime }))
    disposeUnusedHosts(new Set(enabled.flatMap(p => (p.type === 'extension' ? [p.manifest.id] : []))))
  }
  rebuildProviders()

  ipcMain.handle('providers:list', (event): ProvidersResponse => {
    assertTrustedSender(event)
    return { ok: true, providers: settings.list() }
  })

  ipcMain.handle('providers:save-torznab', (event, form: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.saveTorznab(form)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('providers:set-enabled', (event, id: unknown, enabled: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setEnabled(id, enabled)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('providers:remove', (event, id: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.remove(id)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:import', (event, repositoryUrl: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      const { url, installs } = await downloadRepository(repositoryUrl)
      await settings.installExtensions(url, installs)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:set-options', (event, id: unknown, values: unknown) => {
    assertTrustedSender(event)
    return settingsResult(async () => {
      await settings.setExtensionOptions(id, values)
      rebuildProviders()
    }, settings)
  })

  ipcMain.handle('extensions:test', async (event, id: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.extensionConfig(id)
      const runtime = extensionRuntime(config.manifest, config.code, config.codeSha256)
      return { ok: true, message: await testExtension(config.manifest, runtime, config.options) }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof ExtensionError) return { ok: false, error: err.message }
      console.error('[extensions] test failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'The extension isn’t working.' }
    }
  })

  ipcMain.handle('providers:test-torznab', async (event, form: unknown): Promise<TestResponse> => {
    assertTrustedSender(event)
    try {
      const config = settings.resolveTorznab(form)
      return { ok: true, message: await testTorznab({ ...config, id: config.id ?? 'torznab-test' }) }
    } catch (err) {
      if (err instanceof SettingsError || err instanceof TorznabError) return { ok: false, error: err.message }
      console.error('[settings] test failed:', err instanceof Error ? err.message : err)
      return { ok: false, error: 'Couldn’t reach that indexer.' }
    }
  })
}
