import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeTheme,
  DEFAULT_APPEARANCE,
  matchingPreset,
  PRESETS,
  presetAppearance,
  randomAppearance,
  sanitizeAppearance
} from './appearance.ts'
import { contrast, hexToRgb, hslToRgb, onColor, rgbToHex, rgbToHsl } from './color.ts'

test('colour conversions round-trip', () => {
  for (const hex of ['#ff5c8a', '#8a6bff', '#000000', '#ffffff', '#3f9e6b']) {
    assert.equal(rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex)))), hex)
  }
  assert.ok(contrast([255, 255, 255], [0, 0, 0]) > 20)
  assert.deepEqual(onColor(hexToRgb('#ff5c8a')), [255, 255, 255]) // white on the default pink
  assert.notDeepEqual(onColor(hexToRgb('#ffd25c')), [255, 255, 255]) // dark text on yellow
})

test('the default theme reproduces the original palette', () => {
  const { tokens, attributes } = computeTheme(DEFAULT_APPEARANCE)
  assert.equal(tokens['--accent'], '#ff5c8a')
  assert.equal(tokens['--accent-rgb'], '255 92 138')
  assert.equal(tokens['--btn-radius'], '999px')
  assert.equal(tokens['--radius'], '16px')
  assert.equal(attributes['data-surface'], 'classic')
  // Background stays a deep violet close to the hand-picked #0d0a1a.
  const [r, g, b] = hexToRgb(tokens['--bg'])
  assert.ok(Math.abs(r - 13) <= 4 && Math.abs(g - 10) <= 4 && Math.abs(b - 26) <= 6, tokens['--bg'])
})

test('light mode flips the canvas and overlays', () => {
  const { tokens, titleBar } = computeTheme({ ...DEFAULT_APPEARANCE, mode: 'light' })
  assert.ok(contrast(hexToRgb(tokens['--bg']), [255, 255, 255]) < 1.2, 'light background')
  assert.ok(contrast(hexToRgb(tokens['--text']), hexToRgb(tokens['--bg'])) > 10, 'readable text')
  assert.notEqual(tokens['--ink-rgb'], '255 255 255')
  assert.equal(titleBar.color, tokens['--bg'])
})

test('glow 0 turns glows off; frosted is stronger than glass', () => {
  assert.equal(computeTheme({ ...DEFAULT_APPEARANCE, glow: 0 }).tokens['--glow'], 'none')
  const glass = computeTheme({ ...DEFAULT_APPEARANCE, surface: 'glass' }).tokens
  const frosted = computeTheme({ ...DEFAULT_APPEARANCE, surface: 'frosted' }).tokens
  assert.ok(Number(frosted['--panel-alpha']) > Number(glass['--panel-alpha']))
  assert.ok(Number.parseInt(frosted['--panel-blur'], 10) > Number.parseInt(glass['--panel-blur'], 10))
})

test('sanitizeAppearance keeps valid values and repairs the rest', () => {
  const clean = sanitizeAppearance({
    accent: '#3EC7FF',
    mode: 'light',
    radius: 999,
    uiScale: 10,
    surface: 'chrome',
    font: 'serif',
    sakura: 'yes',
    extra: '<script>'
  })
  assert.equal(clean.accent, '#3ec7ff')
  assert.equal(clean.mode, 'light')
  assert.equal(clean.radius, 28)
  assert.equal(clean.uiScale, 80)
  assert.equal(clean.surface, DEFAULT_APPEARANCE.surface)
  assert.equal(clean.font, 'serif')
  assert.equal(clean.sakura, DEFAULT_APPEARANCE.sakura)
  assert.equal('extra' in clean, false)
  assert.deepEqual(sanitizeAppearance('not json'), DEFAULT_APPEARANCE)
  assert.equal(sanitizeAppearance({ accent: 'red; background: url(x)' }).accent, DEFAULT_APPEARANCE.accent)
})

test('presets are valid and recognised', () => {
  assert.equal(matchingPreset(DEFAULT_APPEARANCE)?.id, 'night-violet')
  for (const preset of PRESETS) {
    const values = presetAppearance(preset)
    assert.deepEqual(sanitizeAppearance(values), values, preset.id)
    assert.equal(matchingPreset(values)?.id, preset.id)
  }
  for (let i = 0; i < 20; i++) {
    const random = randomAppearance()
    assert.deepEqual(sanitizeAppearance(random), random)
  }
})
