import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ExtensionOptionView, ProviderSettingsView } from '../../shared/types.ts'
import { type ExtensionManifest, parseRepository } from '../extension-host/manifest.ts'
import { isPrivateHost } from '../net.ts'

/** Encrypts secrets at rest; Electron's safeStorage (DPAPI / Keychain / libsecret) in the app, a fake in tests. */
export interface SecretBox {
  available(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

/** User-facing validation/storage error. */
export class SettingsError extends Error {
  name = 'SettingsError'
}

interface StoredExtension {
  type: 'extension'
  id: string
  enabled: boolean
  /** Repository manifest URL it was installed from */
  repository: string
  manifest: ExtensionManifest
  /** SHA-256 of the code file, checked on every launch */
  codeSha256: string
  options: Record<string, string | boolean>
  /** SecretBox ciphertexts for secret options */
  secrets: Record<string, string>
}

type StoredProvider =
  | { type: 'archive'; id: 'archive'; enabled: boolean }
  | {
      type: 'torznab'
      id: string
      name: string
      url: string
      enabled: boolean
      apiKey?: string /* SecretBox ciphertext */
    }
  | StoredExtension

/** What the registry needs to build providers; only ever lives in the main process. */
export type EnabledProvider =
  | { type: 'archive' }
  | { type: 'torznab'; id: string; name: string; url: string; apiKey: string }
  | {
      type: 'extension'
      manifest: ExtensionManifest
      code: string
      codeSha256: string
      options: Record<string, string | boolean>
    }

const FILE_VERSION = 1
const MAX_TORZNAB = 20
const NAME = /^[^\p{Cc}]{1,60}$/u
const API_KEY = /^[\x21-\x7e]{1,200}$/
const ID = /^torznab-[a-f0-9]{8}$/
const MAX_EXTENSIONS = 30
const MAX_OPTION_LENGTH = 500

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Repositories may use plain http only on the user's own network. */
export function validateRepositoryUrl(raw: unknown): { url: string; privateHttp: boolean } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048)
    throw new SettingsError('Enter the repository’s manifest URL.')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new SettingsError('That isn’t a valid URL.')
  }
  if (url.username || url.password) throw new SettingsError('Links with credentials aren’t supported.')
  const privateHttp = url.protocol === 'http:' && isPrivateHost(url.hostname)
  if (url.protocol !== 'https:' && !privateHttp) throw new SettingsError('Extension repositories must use https.')
  return { url: url.toString(), privateHttp }
}

/** The stored (normalised) manifest in the format parseRepository accepts, for re-validation on load. */
function toRawManifest(manifest: ExtensionManifest): Record<string, unknown> {
  return {
    manifestVersion: 1,
    type: 'torrent',
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    code: manifest.codeUrl,
    hosts: manifest.hosts,
    layout: manifest.layout,
    categories: manifest.categories,
    options: manifest.options,
    enabledByDefault: manifest.enabledByDefault
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const archiveEntry = (): StoredProvider => ({ type: 'archive', id: 'archive', enabled: true })

/**
 * Checks a Torznab feed URL and returns it normalised. Throws {@link SettingsError} for anything unusable, including
 * credentials or a query string in the URL, and plain http outside the local network (the API key travels in the query).
 */
export function validateTorznabUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new SettingsError('Enter the indexer’s Torznab URL.')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new SettingsError('That isn’t a valid URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SettingsError('Use an http:// or https:// URL.')
  if (url.username || url.password) throw new SettingsError('Put the API key in its own field, not in the URL.')
  if (url.search || url.hash) throw new SettingsError('Leave the query string out of the URL — Chomusuke adds it.')
  // The API key travels in the query string, so plain http is only OK on your own network.
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new SettingsError('Use https for indexers outside your own network.')
  }
  return url.toString()
}

/**
 * The user's sources (`providers.json`): the Internet Archive, Torznab indexers and installed extensions. API keys are
 * encrypted with the OS credential store ({@link SecretBox}) and never returned to the renderer; extension code lives
 * in its own files and is checked against its SHA-256 on load, so code edited on disk is not run.
 */
export class ProviderSettingsStore {
  private entries: StoredProvider[] = [archiveEntry()]
  private readonly codes = new Map<string, string>()
  /** Bundled extensions the user removed; they are not reinstalled. */
  private dismissed = new Set<string>()
  private readonly file: string
  private readonly box: SecretBox
  private readonly extensionsDir: string

  constructor(file: string, box: SecretBox, extensionsDir = path.join(path.dirname(file), 'extensions')) {
    this.file = file
    this.box = box
    this.extensionsDir = extensionsDir
  }

  private codeFile(manifest: ExtensionManifest): string {
    return path.join(this.extensionsDir, `${manifest.id}.js`)
  }

  /** Loads saved settings; unreadable or invalid entries are dropped rather than trusted. */
  async load(): Promise<void> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      this.entries = [archiveEntry()]
      return
    }
    const list = isRecord(raw) && Array.isArray(raw.providers) ? raw.providers : []
    this.dismissed = new Set(
      isRecord(raw) && Array.isArray(raw.dismissedExtensions)
        ? raw.dismissedExtensions.filter(v => typeof v === 'string')
        : []
    )
    const entries: StoredProvider[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      if (item.type === 'archive') entries.push({ type: 'archive', id: 'archive', enabled: item.enabled !== false })
      if (item.type === 'torznab' && typeof item.id === 'string' && ID.test(item.id)) {
        try {
          entries.push({
            type: 'torznab',
            id: item.id,
            name: typeof item.name === 'string' && NAME.test(item.name) ? item.name : 'Torznab indexer',
            url: validateTorznabUrl(item.url),
            enabled: item.enabled !== false,
            apiKey: typeof item.apiKey === 'string' ? item.apiKey : undefined
          })
        } catch {
          // Skip entries that no longer pass validation.
        }
      }
    }
    for (const item of list) {
      if (!isRecord(item) || item.type !== 'extension') continue
      const extension = await this.loadExtension(item)
      if (extension) entries.push(extension)
    }
    if (!entries.some(e => e.type === 'archive')) entries.unshift(archiveEntry())
    this.entries = entries.slice(0, MAX_TORZNAB + MAX_EXTENSIONS + 1)
  }

  /** Re-validates a saved extension and checks its code file wasn't changed behind our back. */
  private async loadExtension(item: Record<string, unknown>): Promise<StoredExtension | undefined> {
    try {
      if (typeof item.repository !== 'string' || !isRecord(item.manifest) || typeof item.codeSha256 !== 'string')
        return undefined
      const { url, privateHttp } = validateRepositoryUrl(item.repository)
      const [manifest] = parseRepository(
        [toRawManifest(item.manifest as unknown as ExtensionManifest)],
        url,
        privateHttp
      )
      const code = await readFile(this.codeFile(manifest), 'utf8')
      if (sha256(code) !== item.codeSha256) {
        console.error(`[settings] extension ${manifest.id} was modified on disk; skipping it`)
        return undefined
      }
      this.codes.set(manifest.id, code)
      const options: Record<string, string | boolean> = {}
      const secrets: Record<string, string> = {}
      for (const [key, option] of Object.entries(manifest.options)) {
        const value = isRecord(item.options) ? item.options[key] : undefined
        const secret = isRecord(item.secrets) ? item.secrets[key] : undefined
        if (option.secret && typeof secret === 'string') secrets[key] = secret
        if (!option.secret && typeof value === option.type) options[key] = value as string | boolean
      }
      return {
        type: 'extension',
        id: `ext-${manifest.id}`,
        enabled: item.enabled !== false,
        repository: url,
        manifest,
        codeSha256: item.codeSha256,
        options,
        secrets
      }
    } catch {
      return undefined
    }
  }

  /** Installs or updates extensions from a repository (code already downloaded and validated). */
  async installExtensions(
    repository: string,
    installs: Array<{ manifest: ExtensionManifest; code: string }>
  ): Promise<void> {
    // Check the limit for the whole batch before touching disk, so files and settings never diverge.
    const installed = new Set(this.entries.filter(e => e.type === 'extension').map(e => e.id))
    const added = installs.filter(({ manifest }) => !installed.has(`ext-${manifest.id}`)).length
    if (installed.size + added > MAX_EXTENSIONS) throw new SettingsError('That’s enough extensions.')

    await mkdir(this.extensionsDir, { recursive: true })
    for (const { manifest, code } of installs) {
      const id = `ext-${manifest.id}`
      this.dismissed.delete(manifest.id)
      const index = this.entries.findIndex(e => e.id === id)
      await writeFile(this.codeFile(manifest), code, 'utf8')
      this.codes.set(manifest.id, code)
      const previous = index >= 0 ? this.entries[index] : undefined
      // Saved options/secrets only carry over to an update of the same extension: same repository and the
      // same hosts. A different repository reusing the id must not receive the user's keys.
      const sameSource =
        previous?.type === 'extension' &&
        previous.repository === repository &&
        [...previous.manifest.hosts].sort().join() === [...manifest.hosts].sort().join()
      const kept = sameSource && previous?.type === 'extension' ? previous : undefined
      const entry: StoredExtension = {
        type: 'extension',
        id,
        enabled: kept?.enabled ?? manifest.enabledByDefault,
        repository,
        manifest,
        codeSha256: sha256(code),
        options: Object.fromEntries(Object.entries(kept?.options ?? {}).filter(([key]) => key in manifest.options)),
        secrets: Object.fromEntries(
          Object.entries(kept?.secrets ?? {}).filter(([key]) => manifest.options[key]?.secret)
        )
      }
      if (index >= 0) this.entries[index] = entry
      else this.entries.push(entry)
    }
    await this.persist()
  }

  /**
   * Installs bundled extensions the user hasn't removed, and updates installed ones that came from the bundle
   * when the shipped code changes. Extensions the user installed from elsewhere are left alone.
   */
  async syncBundled(repository: string, bundled: Array<{ manifest: ExtensionManifest; code: string }>): Promise<void> {
    const pending = bundled.filter(({ manifest, code }) => {
      const entry = this.entries.find(e => e.id === `ext-${manifest.id}`)
      if (!entry) return !this.dismissed.has(manifest.id)
      return entry.type === 'extension' && entry.repository === repository && entry.codeSha256 !== sha256(code)
    })
    if (pending.length > 0) await this.installExtensions(repository, pending)
  }

  /** Saves option values; for secrets, an empty string keeps the saved value. */
  async setExtensionOptions(id: unknown, values: unknown): Promise<void> {
    const entry = this.entries.find(e => e.id === id)
    if (entry?.type !== 'extension') throw new SettingsError('That extension no longer exists.')
    if (!isRecord(values)) throw new SettingsError('Invalid options.')
    for (const [key, option] of Object.entries(entry.manifest.options)) {
      const value = values[key]
      if (value === undefined) continue
      if (typeof value !== option.type) throw new SettingsError(`“${option.label}” has the wrong type.`)
      if (typeof value === 'string' && value.length > MAX_OPTION_LENGTH)
        throw new SettingsError(`“${option.label}” is too long.`)
      if (option.secret) {
        if (value === '') continue
        if (!this.box.available()) throw new SettingsError('Secure storage isn’t available, so secrets can’t be saved.')
        entry.secrets[key] = this.box.encrypt(value as string)
      } else {
        entry.options[key] = value as string | boolean
      }
    }
    await this.persist()
  }

  extensionConfig(id: unknown): Extract<EnabledProvider, { type: 'extension' }> {
    const entry = this.entries.find(e => e.id === id)
    if (entry?.type !== 'extension') throw new SettingsError('That extension no longer exists.')
    return this.extensionRuntimeConfig(entry)
  }

  private extensionRuntimeConfig(entry: StoredExtension): Extract<EnabledProvider, { type: 'extension' }> {
    const options: Record<string, string | boolean> = {}
    for (const [key, option] of Object.entries(entry.manifest.options)) {
      if (option.secret) {
        options[key] = entry.secrets[key] ? this.box.decrypt(entry.secrets[key]) : ''
      } else {
        options[key] = entry.options[key] ?? option.default ?? (option.type === 'boolean' ? false : '')
      }
    }
    const code = this.codes.get(entry.manifest.id) ?? ''
    return { type: 'extension', manifest: entry.manifest, code, codeSha256: entry.codeSha256, options }
  }

  list(): ProviderSettingsView[] {
    return this.entries.map((entry): ProviderSettingsView => {
      if (entry.type === 'archive')
        return { id: entry.id, type: entry.type, name: 'Internet Archive', enabled: entry.enabled, builtIn: true }
      if (entry.type === 'torznab') {
        return {
          id: entry.id,
          type: entry.type,
          name: entry.name,
          enabled: entry.enabled,
          builtIn: false,
          url: entry.url,
          hasApiKey: !!entry.apiKey
        }
      }
      const options = Object.entries(entry.manifest.options).map(
        ([key, option]): ExtensionOptionView => ({
          key,
          type: option.type,
          label: option.label,
          description: option.description,
          secret: option.secret,
          ...(option.secret
            ? { hasValue: Boolean(entry.secrets[key]) }
            : { value: entry.options[key] ?? option.default })
        })
      )
      return {
        id: entry.id,
        type: 'extension',
        name: entry.manifest.name,
        enabled: entry.enabled,
        builtIn: false,
        url: entry.repository,
        version: entry.manifest.version,
        description: entry.manifest.description,
        hosts: entry.manifest.hosts,
        options
      }
    })
  }

  /**
   * Validates a Torznab form. Returns the plain config (with the saved key when the form leaves it blank)
   * so it can be tested before saving.
   */
  resolveTorznab(input: unknown): { id?: string; name: string; url: string; apiKey: string } {
    if (!isRecord(input)) throw new SettingsError('Fill in the indexer details.')
    const id = typeof input.id === 'string' && input.id ? input.id : undefined
    const existing = id ? this.entries.find(e => e.type === 'torznab' && e.id === id) : undefined
    if (id && !existing) throw new SettingsError('That indexer no longer exists.')

    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!NAME.test(name)) throw new SettingsError('Give the indexer a name (up to 60 characters).')
    const url = validateTorznabUrl(input.url)

    const typedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    let apiKey = typedKey
    if (!typedKey && existing?.type === 'torznab' && existing.apiKey) {
      // Never send a saved key to a different server than the one it was saved for.
      if (new URL(existing.url).origin !== new URL(url).origin) {
        throw new SettingsError('Re-enter the API key for the new address.')
      }
      apiKey = this.box.decrypt(existing.apiKey)
    }
    if (!API_KEY.test(apiKey)) throw new SettingsError('Enter the indexer’s API key.')
    return { id, name, url, apiKey }
  }

  async saveTorznab(input: unknown): Promise<void> {
    const config = this.resolveTorznab(input)
    if (!this.box.available()) {
      throw new SettingsError('Secure storage isn’t available on this system, so the API key can’t be saved.')
    }
    const entry: StoredProvider = {
      type: 'torznab',
      id: config.id ?? `torznab-${randomUUID().slice(0, 8)}`,
      name: config.name,
      url: config.url,
      enabled: true,
      apiKey: this.box.encrypt(config.apiKey)
    }
    const index = this.entries.findIndex(e => e.id === entry.id)
    if (index >= 0) {
      entry.enabled = this.entries[index].enabled
      this.entries[index] = entry
    } else {
      if (this.entries.filter(e => e.type === 'torznab').length >= MAX_TORZNAB)
        throw new SettingsError('That’s enough indexers.')
      this.entries.push(entry)
    }
    await this.persist()
  }

  async setEnabled(id: unknown, enabled: unknown): Promise<void> {
    const entry = this.entries.find(e => e.id === id)
    if (!entry || typeof enabled !== 'boolean') throw new SettingsError('That source no longer exists.')
    entry.enabled = enabled
    await this.persist()
  }

  async remove(id: unknown): Promise<void> {
    const entry = this.entries.find(e => e.id === id)
    if (!entry || entry.type === 'archive') throw new SettingsError('That source can’t be removed.')
    this.entries = this.entries.filter(e => e !== entry)
    if (entry.type === 'extension') {
      this.dismissed.add(entry.manifest.id)
      this.codes.delete(entry.manifest.id)
      await rm(this.codeFile(entry.manifest), { force: true })
    }
    await this.persist()
  }

  enabled(): EnabledProvider[] {
    const result: EnabledProvider[] = []
    for (const entry of this.entries) {
      if (!entry.enabled) continue
      if (entry.type === 'archive') result.push({ type: 'archive' })
      else if (entry.type === 'extension') {
        try {
          result.push(this.extensionRuntimeConfig(entry))
        } catch {
          console.error(`[settings] couldn't decrypt options for ${entry.id}; skipping it`)
        }
      } else if (entry.apiKey) {
        try {
          result.push({
            type: 'torznab',
            id: entry.id,
            name: entry.name,
            url: entry.url,
            apiKey: this.box.decrypt(entry.apiKey)
          })
        } catch {
          console.error(`[settings] couldn't decrypt the API key for ${entry.id}; skipping it`)
        }
      }
    }
    return result
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify(
      { version: FILE_VERSION, providers: this.entries, dismissedExtensions: [...this.dismissed] },
      null,
      2
    )
    const temp = `${this.file}.tmp`
    await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.file)
  }
}
