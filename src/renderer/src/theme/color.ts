// Small colour helpers for the theme engine: hex ↔ RGB ↔ HSL, mixing and contrast.

export type Rgb = readonly [r: number, g: number, b: number]
export type Hsl = readonly [h: number, s: number, l: number]

const HEX = /^#?([0-9a-f]{6})$/i

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

export function hexToRgb(hex: string): Rgb {
  const match = HEX.exec(hex)
  if (!match) return [0, 0, 0]
  const n = Number.parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map(c =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** "r g b" for `rgb(var(--x-rgb) / alpha)`. */
export const channels = ([r, g, b]: Rgb): string => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s * 100, l * 100]
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  if (sn === 0) return [ln * 255, ln * 255, ln * 255]
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const channel = (t: number) => {
    const tn = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  return [channel(hn + 1 / 3) * 255, channel(hn) * 255, channel(hn - 1 / 3) * 255]
}

/** Linear mix: 0 → a, 1 → b. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Text colour for labels on an accent-coloured button: white unless the accent is so light (yellow, cyan,
 * pastel) that white would wash out. Large bold button labels read fine from about 2.2:1.
 */
export function onColor(background: Rgb, light: Rgb = [255, 255, 255], dark: Rgb = [26, 16, 48]): Rgb {
  return contrast(background, light) >= 2.2 ? light : dark
}
