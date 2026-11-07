import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RELEASES_URL, releasePageUrl, updateMode } from './update-mode.ts'

const base = { isPackaged: true, nsisInstalled: false, appImage: false }

test('running from source never checks', () => {
  assert.equal(updateMode({ ...base, isPackaged: false, platform: 'win32', nsisInstalled: true }), 'off')
})

test('Windows installs itself only when installed by the installer', () => {
  assert.equal(updateMode({ ...base, platform: 'win32', nsisInstalled: true }), 'auto')
  assert.equal(updateMode({ ...base, platform: 'win32' }), 'notify')
})

test('Linux installs itself only as an AppImage', () => {
  assert.equal(updateMode({ ...base, platform: 'linux', appImage: true }), 'auto')
  assert.equal(updateMode({ ...base, platform: 'linux' }), 'notify')
})

test('macOS only notifies (unsigned builds cannot update themselves)', () => {
  assert.equal(updateMode({ ...base, platform: 'darwin' }), 'notify')
})

test('release page links the exact version, or the list for anything odd', () => {
  assert.equal(releasePageUrl('1.4.2'), `${RELEASES_URL}/tag/v1.4.2`)
  assert.equal(releasePageUrl('1.4.2/../../evil'), RELEASES_URL)
  assert.equal(releasePageUrl(''), RELEASES_URL)
})
