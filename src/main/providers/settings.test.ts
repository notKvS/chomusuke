import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ProviderSettingsStore, SettingsError, validateTorznabUrl, type SecretBox } from './settings.ts'

// Reversible fake: good enough to prove the key is never written in plain text.
const box: SecretBox = {
  available: () => true,
  encrypt: plain => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: cipher => Buffer.from(cipher.replace(/^enc:/, ''), 'base64').toString()
}

async function withStore(run: (store: ProviderSettingsStore, file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-settings-'))
  try {
    const file = path.join(dir, 'providers.json')
    const store = new ProviderSettingsStore(file, box)
    await store.load()
    await run(store, file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const form = { name: 'Jackett', url: 'http://localhost:9117/api/v2.0/indexers/all/results/torznab/api', apiKey: 'abc123' }

test('starts with the Internet Archive enabled', () =>
  withStore(async store => {
    assert.deepEqual(store.list(), [{ id: 'archive', type: 'archive', name: 'Internet Archive', enabled: true, builtIn: true }])
    assert.deepEqual(store.enabled(), [{ type: 'archive' }])
  }))

test('saves a Torznab indexer with an encrypted key and reloads it', () =>
  withStore(async (store, file) => {
    await store.saveTorznab(form)
    const saved = await readFile(file, 'utf8')
    assert.doesNotMatch(saved, /abc123/)

    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    const [, indexer] = reloaded.list()
    assert.equal(indexer.name, 'Jackett')
    assert.equal(indexer.hasApiKey, true)
    assert.equal('apiKey' in indexer, false)
    assert.deepEqual(reloaded.enabled()[1], { type: 'torznab', id: indexer.id, name: 'Jackett', url: form.url, apiKey: 'abc123' })
  }))

test('editing with a blank key keeps the saved key; toggling and removing work', () =>
  withStore(async store => {
    await store.saveTorznab(form)
    const id = store.list()[1].id
    await store.saveTorznab({ id, name: 'Renamed', url: form.url, apiKey: '' })
    assert.equal(store.list()[1].name, 'Renamed')
    assert.equal(store.resolveTorznab({ id, name: 'x', url: form.url, apiKey: '' }).apiKey, 'abc123')

    await store.setEnabled(id, false)
    assert.deepEqual(store.enabled(), [{ type: 'archive' }])
    await store.setEnabled('archive', false)
    assert.deepEqual(store.enabled(), [])

    await store.remove(id)
    assert.equal(store.list().length, 1)
    await assert.rejects(store.remove('archive'), SettingsError)
  }))

test('rejects bad input', () =>
  withStore(async store => {
    await assert.rejects(store.saveTorznab({ ...form, apiKey: '' }), /API key/)
    await assert.rejects(store.saveTorznab({ ...form, name: '' }), /name/)
    await assert.rejects(store.saveTorznab({ ...form, id: 'torznab-deadbeef' }), /no longer exists/)
    await assert.rejects(store.saveTorznab('nope'), SettingsError)
  }))

test('refuses to store keys when secure storage is unavailable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chomusuke-settings-'))
  try {
    const store = new ProviderSettingsStore(path.join(dir, 'p.json'), { ...box, available: () => false })
    await assert.rejects(store.saveTorznab(form), /Secure storage/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ignores tampered or invalid saved entries', () =>
  withStore(async (store, file) => {
    await writeFile(
      file,
      JSON.stringify({
        providers: [
          { type: 'torznab', id: '../../x', name: 'evil', url: 'http://localhost/api', apiKey: 'enc:YQ==' },
          { type: 'torznab', id: 'torznab-0000beef', name: 'public http', url: 'http://example.com/api', apiKey: 'enc:YQ==' },
          { type: 'torznab', id: 'torznab-1234abcd', name: 'ok', url: 'https://example.com/api', apiKey: 'enc:YQ==' }
        ]
      })
    )
    await store.load()
    assert.deepEqual(
      store.list().map(p => p.id),
      ['archive', 'torznab-1234abcd']
    )
  }))

test('validateTorznabUrl', () => {
  assert.equal(validateTorznabUrl('https://indexer.example.com/api'), 'https://indexer.example.com/api')
  assert.equal(validateTorznabUrl('http://192.168.1.10:9696/1/api'), 'http://192.168.1.10:9696/1/api')
  for (const bad of ['ftp://x/api', 'http://example.com/api', 'https://u:p@x.com/api', 'https://x.com/api?apikey=1', 'not a url', 42]) {
    assert.throws(() => validateTorznabUrl(bad), SettingsError, String(bad))
  }
})
