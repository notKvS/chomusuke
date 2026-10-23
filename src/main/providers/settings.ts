import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { ProviderSettingsView } from '../../shared/types.ts'
import { isPrivateHost } from './torznab.ts'

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

type StoredProvider =
  | { type: 'archive'; id: 'archive'; enabled: boolean }
  | { type: 'torznab'; id: string; name: string; url: string; enabled: boolean; apiKey?: string /* SecretBox ciphertext */ }

/** What the registry needs to build providers; only ever lives in the main process. */
export type EnabledProvider = { type: 'archive' } | { type: 'torznab'; id: string; name: string; url: string; apiKey: string }

const FILE_VERSION = 1
const MAX_TORZNAB = 20
const NAME = /^[^\p{Cc}]{1,60}$/u
const API_KEY = /^[\x21-\x7e]{1,200}$/
const ID = /^torznab-[a-f0-9]{8}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const archiveEntry = (): StoredProvider => ({ type: 'archive', id: 'archive', enabled: true })

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

export class ProviderSettingsStore {
  private entries: StoredProvider[] = [archiveEntry()]
  private readonly file: string
  private readonly box: SecretBox

  constructor(file: string, box: SecretBox) {
    this.file = file
    this.box = box
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
    if (!entries.some(e => e.type === 'archive')) entries.unshift(archiveEntry())
    this.entries = entries.slice(0, MAX_TORZNAB + 1)
  }

  list(): ProviderSettingsView[] {
    return this.entries.map(entry =>
      entry.type === 'archive'
        ? { id: entry.id, type: entry.type, name: 'Internet Archive', enabled: entry.enabled, builtIn: true }
        : { id: entry.id, type: entry.type, name: entry.name, enabled: entry.enabled, builtIn: false, url: entry.url, hasApiKey: !!entry.apiKey }
    )
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
    if (!typedKey && existing?.type === 'torznab' && existing.apiKey) apiKey = this.box.decrypt(existing.apiKey)
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
      if (this.entries.filter(e => e.type === 'torznab').length >= MAX_TORZNAB) throw new SettingsError('That’s enough indexers.')
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
    await this.persist()
  }

  enabled(): EnabledProvider[] {
    const result: EnabledProvider[] = []
    for (const entry of this.entries) {
      if (!entry.enabled) continue
      if (entry.type === 'archive') result.push({ type: 'archive' })
      else if (entry.apiKey) {
        try {
          result.push({ type: 'torznab', id: entry.id, name: entry.name, url: entry.url, apiKey: this.box.decrypt(entry.apiKey) })
        } catch {
          console.error(`[settings] couldn't decrypt the API key for ${entry.id}; skipping it`)
        }
      }
    }
    return result
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify({ version: FILE_VERSION, providers: this.entries }, null, 2)
    const temp = `${this.file}.tmp`
    await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.file)
  }
}
