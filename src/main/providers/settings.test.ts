import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ProviderSettingsStore, type SecretBox, SettingsError, validateTorznabUrl } from './settings.ts'

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

const form = {
  name: 'My indexer',
  url: 'http://localhost:9117/api/v2.0/indexers/all/results/torznab/api',
  apiKey: 'abc123'
}

test('starts with the Internet Archive enabled', () =>
  withStore(async store => {
    assert.deepEqual(store.list(), [
      { id: 'archive', type: 'archive', name: 'Internet Archive', enabled: true, builtIn: true }
    ])
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
    assert.equal(indexer.name, 'My indexer')
    assert.equal(indexer.hasApiKey, true)
    assert.equal('apiKey' in indexer, false)
    assert.deepEqual(reloaded.enabled()[1], {
      type: 'torznab',
      id: indexer.id,
      name: 'My indexer',
      url: form.url,
      apiKey: 'abc123'
    })
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
          {
            type: 'torznab',
            id: 'torznab-0000beef',
            name: 'public http',
            url: 'http://example.com/api',
            apiKey: 'enc:YQ=='
          },
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
  for (const bad of [
    'ftp://x/api',
    'http://example.com/api',
    'https://u:p@x.com/api',
    'https://x.com/api?apikey=1',
    'not a url',
    42
  ]) {
    assert.throws(() => validateTorznabUrl(bad), SettingsError, String(bad))
  }
})

test('a saved key is only reused for the same server', () =>
  withStore(async store => {
    await store.saveTorznab(form)
    const id = store.list()[1].id
    assert.throws(
      () => store.resolveTorznab({ id, name: 'x', url: 'https://attacker.example/api', apiKey: '' }),
      /Re-enter the API key/
    )
    assert.throws(
      () => store.resolveTorznab({ id, name: 'x', url: 'http://localhost:9999/api', apiKey: '' }),
      /Re-enter/
    )
    assert.equal(
      store.resolveTorznab({ id, name: 'x', url: 'http://localhost:9117/other/path', apiKey: '' }).apiKey,
      'abc123'
    )
  }))

test('installs plugins, verifies their code on load, and keeps secrets encrypted', () =>
  withStore(async (store, file) => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const [manifest] = parseRepository(
      [
        {
          manifestVersion: 1,
          id: 'demo',
          name: 'Demo',
          version: '1.0.0',
          type: 'torrent',
          code: 'demo.js',
          hosts: ['example.org'],
          options: {
            token: { type: 'string', label: 'Token', secret: true },
            lossless: { type: 'boolean', label: 'Lossless', default: true }
          }
        }
      ],
      'https://example.org/index.json'
    )
    const code = 'export default { search: () => [] }'
    await store.installPlugins('https://example.org/index.json', [{ manifest, code }])
    await store.setPluginOptions('plugin-demo', { token: 'tok-123', lossless: false })
    await assert.rejects(store.setPluginOptions('plugin-demo', { lossless: 'yes' }), /wrong type/)

    assert.doesNotMatch(await readFile(file, 'utf8'), /tok-123/)
    const view = store.list().find(p => p.id === 'plugin-demo')
    assert.deepEqual(view?.options, [
      {
        key: 'token',
        type: 'string',
        label: 'Token',
        description: undefined,
        secret: true,
        required: false,
        placeholder: undefined,
        hasValue: true
      },
      {
        key: 'lossless',
        type: 'boolean',
        label: 'Lossless',
        description: undefined,
        secret: false,
        required: false,
        placeholder: undefined,
        value: false
      }
    ])
    assert.deepEqual(store.pluginConfig('plugin-demo').options, { token: 'tok-123', lossless: false })

    // Reload: same code passes, tampered code is dropped.
    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    assert.equal(reloaded.pluginConfig('plugin-demo').code, code)
    await writeFile(path.join(path.dirname(file), 'plugins', 'demo.js'), 'export default { search: () => steal() }')
    const tampered = new ProviderSettingsStore(file, box)
    await tampered.load()
    assert.equal(
      tampered.list().some(p => p.id === 'plugin-demo'),
      false
    )

    await store.remove('plugin-demo')
    assert.equal(
      store.list().some(p => p.id === 'plugin-demo'),
      false
    )
  }))

test('validateRepositoryUrl', async () => {
  const { validateRepositoryUrl } = await import('./settings.ts')
  assert.deepEqual(validateRepositoryUrl('https://x.github.io/repo/index.json'), {
    url: 'https://x.github.io/repo/index.json',
    privateHttp: false
  })
  assert.equal(validateRepositoryUrl('http://127.0.0.1:8000/index.json').privateHttp, true)
  assert.throws(() => validateRepositoryUrl('http://example.com/index.json'), /https/)
  assert.throws(() => validateRepositoryUrl('file:///C:/x.json'), /https/)
})

test('a same-id plugin from another repository or with other hosts does not inherit secrets', () =>
  withStore(async store => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const make = (repo: string, hosts: string[]) =>
      parseRepository(
        [
          {
            manifestVersion: 1,
            id: 'demo',
            name: 'Demo',
            version: '1',
            type: 'torrent',
            code: 'd.js',
            hosts,
            options: { token: { type: 'string', label: 'T', secret: true } }
          }
        ],
        repo
      )[0]
    const code = 'export default { search: () => [] }'
    await store.installPlugins('https://good.example/index.json', [
      { manifest: make('https://good.example/index.json', ['good.example']), code }
    ])
    await store.setPluginOptions('plugin-demo', { token: 'secret' })
    // Update from the same repository with the same hosts keeps it…
    await store.installPlugins('https://good.example/index.json', [
      { manifest: make('https://good.example/index.json', ['good.example']), code }
    ])
    assert.equal(store.pluginConfig('plugin-demo').options.token, 'secret')
    // …a hostile repository reusing the id does not.
    await store.installPlugins('https://evil.example/index.json', [
      { manifest: make('https://evil.example/index.json', ['evil.example']), code }
    ])
    assert.equal(store.pluginConfig('plugin-demo').options.token, '')
  }))

test('bundled plugins install once, update when changed, and stay removed', () =>
  withStore(async (store, file) => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const repo = 'https://bundled.chomusuke.invalid/plugins/index.json'
    const manifest = parseRepository(
      [
        {
          manifestVersion: 1,
          id: 'bundled',
          name: 'Bundled',
          version: '1',
          type: 'torrent',
          code: 'b.js',
          hosts: ['archive.org']
        }
      ],
      repo
    )[0]
    await store.syncBundled(repo, [{ manifest, code: 'export default { search: () => [] } // v1' }])
    assert.equal(store.pluginConfig('plugin-bundled').code.endsWith('v1'), true)
    await store.setEnabled('plugin-bundled', false)

    await store.syncBundled(repo, [{ manifest, code: 'export default { search: () => [] } // v2' }])
    assert.equal(store.pluginConfig('plugin-bundled').code.endsWith('v2'), true)
    assert.equal(store.list().find(p => p.id === 'plugin-bundled')?.enabled, false) // user's choice kept

    // A new version with the same code (e.g. new hosts or description) is picked up too.
    const updated = { ...manifest, version: '2', hosts: ['archive.org', 'example.org'] }
    await store.syncBundled(repo, [{ manifest: updated, code: 'export default { search: () => [] } // v2' }])
    assert.deepEqual(store.list().find(p => p.id === 'plugin-bundled')?.hosts, ['archive.org', 'example.org'])

    await store.remove('plugin-bundled')
    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    await reloaded.syncBundled(repo, [{ manifest, code: 'export default { search: () => [] } // v3' }])
    assert.equal(
      reloaded.list().some(p => p.id === 'plugin-bundled'),
      false
    )
  }))

test('an app update that changes a bundled plugin’s hosts keeps the user’s choices and sign-in', () =>
  withStore(async (store, file) => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const repo = 'https://bundled.chomusuke.invalid/plugins/index.json'
    const make = (version: string, hosts: string[]) =>
      parseRepository(
        [
          {
            manifestVersion: 1,
            id: 'tracker',
            name: 'Tracker',
            version,
            type: 'torrent',
            code: 't.js',
            hosts,
            enabledByDefault: false,
            options: {
              mirror: { type: 'string', label: 'Mirror' },
              password: { type: 'string', label: 'Password', secret: true }
            }
          }
        ],
        repo
      )[0]
    await store.syncBundled(repo, [{ manifest: make('1', ['a.example']), code: 'export default {} // v1' }])
    await store.setEnabled('plugin-tracker', true)
    await store.setPluginOptions('plugin-tracker', { mirror: 'a.example', password: 'hunter2' })

    // The next app version adds a mirror.
    await store.syncBundled(repo, [
      { manifest: make('2', ['a.example', 'b.example']), code: 'export default {} // v2' }
    ])
    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    assert.equal(reloaded.list().find(p => p.id === 'plugin-tracker')?.enabled, true)
    const { options } = reloaded.pluginConfig('plugin-tracker')
    assert.equal(options.mirror, 'a.example')
    assert.equal(options.password, 'hunter2')
  }))

test('plugins marked enabledByDefault: false install switched off and keep the user’s choice', () =>
  withStore(async (store, file) => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const repo = 'https://bundled.chomusuke.invalid/plugins/index.json'
    const raw = {
      manifestVersion: 1,
      id: 'template',
      name: 'Template',
      version: '1',
      type: 'torrent',
      code: 't.js',
      hosts: ['example.org'],
      enabledByDefault: false
    }
    const manifest = parseRepository([raw], repo)[0]
    await store.syncBundled(repo, [{ manifest, code: 'export default { search: () => [] } // v1' }])
    assert.equal(store.list().find(p => p.id === 'plugin-template')?.enabled, false)
    assert.equal(store.enabled().length, 1) // only the Internet Archive

    await store.setEnabled('plugin-template', true)
    await store.syncBundled(repo, [{ manifest, code: 'export default { search: () => [] } // v2' }])
    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    assert.equal(reloaded.list().find(p => p.id === 'plugin-template')?.enabled, true)
  }))

test('a plugin missing its required details is flagged for the setup window until they are saved', () =>
  withStore(async store => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const repo = 'https://example.org/index.json'
    const [manifest] = parseRepository(
      [
        {
          manifestVersion: 1,
          id: 'asking',
          name: 'Asking',
          version: '1.0.0',
          type: 'torrent',
          code: 'a.js',
          hosts: ['example.org'],
          setup: 'Sign in with your account.',
          options: {
            username: { type: 'string', label: 'Username', required: true, placeholder: 'Your name' },
            password: { type: 'string', label: 'Password', secret: true, required: true }
          }
        }
      ],
      repo
    )
    await store.installPlugins(repo, [{ manifest, code: 'export default { search: () => [] }' }])
    const view = () => store.list().find(p => p.id === 'plugin-asking')
    assert.equal(view()?.needsSetup, true)
    assert.equal(view()?.setup, 'Sign in with your account.')
    assert.deepEqual(
      view()?.options?.map(o => [o.key, o.required, o.placeholder]),
      [
        ['username', true, 'Your name'],
        ['password', true, undefined]
      ]
    )

    await store.setPluginOptions('plugin-asking', { username: 'me' })
    assert.equal(view()?.needsSetup, true)
    await store.setPluginOptions('plugin-asking', { password: 'secret' })
    assert.equal(view()?.needsSetup, false)
    // The password reaches the plugin decrypted, and only there.
    assert.deepEqual(store.pluginConfig('plugin-asking').options, { username: 'me', password: 'secret' })
    assert.equal(view()?.options?.[1].hasValue, true)
  }))

test('the order of sources can be changed; it is kept across restarts and decides what is searched first', () =>
  withStore(async (store, file) => {
    const { parseRepository } = await import('../plugin-host/manifest.ts')
    const manifests = parseRepository(
      ['one', 'two', 'three'].map(id => ({
        manifestVersion: 1,
        id,
        name: id,
        version: '1',
        type: 'torrent',
        code: `${id}.js`,
        hosts: ['example.org']
      })),
      'https://example.org/index.json'
    )
    await store.saveTorznab(form)
    await store.installPlugins(
      'https://example.org/index.json',
      manifests.map(manifest => ({ manifest, code: 'export default { search: () => [] }' }))
    )
    const indexer = store.list()[1].id
    const ids = () => store.list().map(p => p.id)
    assert.deepEqual(ids(), ['archive', indexer, 'plugin-one', 'plugin-two', 'plugin-three'])

    // Plugins (and the built-in) move among their own places; the indexer between them stays put.
    await store.reorder(['plugin-three', 'archive', 'plugin-one', 'plugin-two'])
    assert.deepEqual(ids(), ['plugin-three', indexer, 'archive', 'plugin-one', 'plugin-two'])
    assert.deepEqual(
      store.enabled().map(p => (p.type === 'plugin' ? p.manifest.id : p.type)),
      ['three', 'torznab', 'archive', 'one', 'two']
    )

    const reloaded = new ProviderSettingsStore(file, box)
    await reloaded.load()
    assert.deepEqual(
      reloaded.list().map(p => p.id),
      ids()
    )

    await assert.rejects(store.reorder(['plugin-one', 'plugin-one']), SettingsError)
    await assert.rejects(store.reorder(['plugin-one', 'nope']), SettingsError)
    await assert.rejects(store.reorder([]), SettingsError)
    await assert.rejects(store.reorder('plugin-one'), SettingsError)
    assert.deepEqual(ids(), ['plugin-three', indexer, 'archive', 'plugin-one', 'plugin-two'])
  }))
