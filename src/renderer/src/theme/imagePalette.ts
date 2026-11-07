// Theme accents picked from a picture, the way Android's Material You does it: quantize the pixels to a small
// palette, rank the colours by how much of the picture they cover and how colourful they are, then set their
// brightness so they read well in the current mode. No DOM access here, so it runs in unit tests.
import { argbFromRgb, Hct, hexFromArgb, QuantizerCelebi, Score } from '@material/material-color-utilities'
import type { Appearance } from './appearance.ts'

/** Score's answer when nothing in the picture is colourful enough (transparent black is never a real pixel). */
const NONE = 0

/** `rgba` is canvas ImageData bytes. Returns null for pictures with no real colour (black and white, greys). */
export function paletteFromPixels(
  rgba: Uint8ClampedArray,
  mode: Appearance['mode']
): { accent: string; accent2: string } | null {
  const pixels: number[] = []
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 255) pixels.push(argbFromRgb(rgba[i], rgba[i + 1], rgba[i + 2]))
  }
  const ranked = Score.score(QuantizerCelebi.quantize(pixels, 128), { desired: 2, fallbackColorARGB: NONE })
    .filter(argb => argb !== NONE)
    .map(argb => Hct.fromInt(argb))
  if (ranked.length === 0) return null

  const dark = mode !== 'light'
  const [main, second] = ranked
  // A one-colour picture gets a neighbouring hue as its secondary accent, so gradients still have two ends.
  const hue2 = second ? second.hue : (main.hue + 40) % 360
  const chroma2 = second ? second.chroma : main.chroma
  return {
    accent: hexFromArgb(Hct.from(main.hue, Math.max(main.chroma, 48), dark ? 72 : 50).toInt()),
    accent2: hexFromArgb(Hct.from(hue2, Math.max(chroma2, 40), dark ? 66 : 56).toInt())
  }
}
