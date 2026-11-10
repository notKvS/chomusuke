import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToRgb, rgbToHsl } from './color.ts'
import { paletteFromPixels, panelColoursFromPixels } from './imagePalette.ts'

/** RGBA bytes: `count` opaque pixels of each colour. */
function pixels(...parts: Array<[rgb: [number, number, number], count: number]>): Uint8ClampedArray {
  const bytes: number[] = []
  for (const [[r, g, b], count] of parts) for (let i = 0; i < count; i++) bytes.push(r, g, b, 255)
  return new Uint8ClampedArray(bytes)
}

const hue = (hex: string) => rgbToHsl(hexToRgb(hex))[0]
const lightness = (hex: string) => rgbToHsl(hexToRgb(hex))[2]

test('the main colour of the image becomes the accent, a second one the secondary accent', () => {
  const palette = paletteFromPixels(pixels([[240, 200, 20], 700], [[30, 60, 200], 300]), 'dark')
  assert.ok(palette)
  assert.ok(Math.abs(hue(palette.accent) - 50) < 15, `accent ${palette.accent} should be yellow`)
  assert.ok(Math.abs(hue(palette.accent2) - 228) < 20, `secondary ${palette.accent2} should be blue`)
})

test('a single-colour image still gets two different accents', () => {
  const palette = paletteFromPixels(pixels([[240, 200, 20], 1000]), 'dark')
  assert.ok(palette)
  assert.notEqual(palette.accent, palette.accent2)
})

test('accents are brightened for dark mode and deepened for light mode', () => {
  const navy = pixels([[20, 30, 110], 1000])
  const dark = paletteFromPixels(navy, 'dark')
  const light = paletteFromPixels(navy, 'light')
  assert.ok(dark && light)
  assert.ok(lightness(dark.accent) > lightness(light.accent))
  assert.ok(lightness(dark.accent) > 50, `dark-mode accent ${dark.accent} should be readable on a dark background`)
})

test('a black-and-white image has no colours to use', () => {
  assert.equal(
    paletteFromPixels(pixels([[0, 0, 0], 500], [[255, 255, 255], 300], [[128, 128, 128], 200]), 'dark'),
    null
  )
})

test('panel colours follow the picture: deep in dark modes, pale in light mode, none for greys', () => {
  const red = pixels([[200, 30, 40], 700], [[30, 60, 200], 300])
  const dark = panelColoursFromPixels(red, 'dark')
  const light = panelColoursFromPixels(red, 'light')
  assert.ok(dark && light)
  assert.ok(lightness(dark.from) < 35, `dark panel ${dark.from} should be deep`)
  assert.ok(lightness(light.from) > 80, `light panel ${light.from} should be pale`)
  assert.ok(
    Math.abs(hue(dark.from) - 355) < 25 || Math.abs(hue(dark.from) - 355) > 335,
    `${dark.from} should be reddish`
  )
  assert.ok(Math.abs(hue(dark.to) - 228) < 25, `${dark.to} should be bluish`)
  assert.equal(panelColoursFromPixels(pixels([[0, 0, 0], 500], [[255, 255, 255], 300]), 'dark'), null)
  // One colour: the second end of the gradient is a neighbouring hue.
  const single = panelColoursFromPixels(pixels([[200, 30, 40], 1000]), 'dark')
  assert.ok(single)
  assert.notEqual(single.from, single.to)
})
