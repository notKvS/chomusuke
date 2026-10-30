// The Appearance model: every look-and-feel setting, the built-in themes, validation of saved/imported
// settings, and the translation into CSS custom properties + data attributes (written to <html> by dom.ts and
// used by theme.css). No DOM access here, so it runs in unit tests.
import { channels, hexToRgb, hslToRgb, isHex, mix, onColor, type Rgb, rgbToHex, rgbToHsl } from './color.ts'

export const MODES = ['dark', 'light'] as const
export const BACKGROUNDS = ['aurora', 'mesh', 'starfield', 'gradient', 'solid', 'image'] as const
export const SURFACES = ['classic', 'glass', 'frosted', 'solid', 'outline'] as const
export const BUTTON_SHAPES = ['pill', 'rounded', 'square'] as const
export const BUTTON_STYLES = ['gradient', 'solid', 'outline', 'glow', 'soft'] as const
export const FONTS = ['rounded', 'system', 'serif', 'mono'] as const
export const PARTICLES = [
  'off',
  'sakura',
  'snow',
  'leaves',
  'bubbles',
  'embers',
  'notes',
  'fireflies',
  'sparkles'
] as const

export interface Appearance {
  mode: (typeof MODES)[number]
  accent: string
  accent2: string
  /** How strongly backgrounds and panels are tinted with the secondary accent's hue, 0–100. */
  tint: number
  background: (typeof BACKGROUNDS)[number]
  /** For the image background: blur in px and darkening/lightening overlay in %. */
  backgroundBlur: number
  backgroundDim: number
  animatedBackground: boolean
  surface: (typeof SURFACES)[number]
  /** Glass/frosted panels: blur in px and opacity in %. */
  glassBlur: number
  glassOpacity: number
  buttonShape: (typeof BUTTON_SHAPES)[number]
  buttonStyle: (typeof BUTTON_STYLES)[number]
  /** Corner radius of cards and panels, px. */
  radius: number
  font: (typeof FONTS)[number]
  /** Interface zoom, %. */
  uiScale: number
  /** Glow strength, %. */
  glow: number
  /** What drifts behind the app (sakura petals, snow…), and how many. */
  particles: (typeof PARTICLES)[number]
  particleCount: number
  mascotMotion: boolean
  splash: boolean
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'dark',
  accent: '#ff5c8a',
  accent2: '#8a6bff',
  tint: 45,
  background: 'aurora',
  backgroundBlur: 8,
  backgroundDim: 55,
  animatedBackground: true,
  surface: 'classic',
  glassBlur: 18,
  glassOpacity: 55,
  buttonShape: 'pill',
  buttonStyle: 'gradient',
  radius: 16,
  font: 'rounded',
  uiScale: 100,
  glow: 100,
  particles: 'sakura',
  particleCount: 12,
  mascotMotion: true,
  splash: true
}

export interface Preset {
  id: string
  name: string
  blurb: string
  values: Partial<Appearance>
}

export const PRESETS: Preset[] = [
  { id: 'night-violet', name: 'Night Violet', blurb: 'The original: pink and violet under a night sky', values: {} },
  {
    id: 'crimson-blast',
    name: 'Crimson Blast',
    blurb: 'Explosive reds and ember gold on frosted glass',
    values: {
      accent: '#ff3b3b',
      accent2: '#ff9f1c',
      tint: 55,
      background: 'mesh',
      surface: 'frosted',
      buttonStyle: 'glow'
    }
  },
  {
    id: 'ocean-drift',
    name: 'Ocean Drift',
    blurb: 'Deep-sea blues behind clear glass',
    values: {
      accent: '#3ec7ff',
      accent2: '#2f6bff',
      tint: 60,
      background: 'mesh',
      surface: 'glass',
      buttonShape: 'rounded'
    }
  },
  {
    id: 'cyber-city',
    name: 'Cyber City',
    blurb: 'Cyan and magenta wireframes on a starry night',
    values: {
      accent: '#00f0ff',
      accent2: '#ff2bd6',
      tint: 35,
      background: 'starfield',
      surface: 'outline',
      buttonShape: 'square',
      buttonStyle: 'outline',
      radius: 6,
      font: 'mono'
    }
  },
  {
    id: 'ember-fox',
    name: 'Ember Fox',
    blurb: 'Warm fire tones, like Chomusuke on a good day',
    values: { accent: '#ff8a3d', accent2: '#ffd25c', tint: 50, background: 'starfield', surface: 'glass', glow: 140 }
  },
  {
    id: 'sakura-daylight',
    name: 'Sakura Daylight',
    blurb: 'Light and airy, blossom pink on paper white',
    values: {
      mode: 'light',
      accent: '#ff4f86',
      accent2: '#b48cff',
      tint: 60,
      background: 'aurora',
      surface: 'glass',
      glow: 60
    }
  },
  {
    id: 'matcha-latte',
    name: 'Matcha Latte',
    blurb: 'Soft greens and coffee on a light, solid canvas',
    values: {
      mode: 'light',
      accent: '#3f9e6b',
      accent2: '#b07a4f',
      tint: 35,
      background: 'gradient',
      surface: 'solid',
      buttonShape: 'rounded',
      buttonStyle: 'solid',
      font: 'serif',
      glow: 30
    }
  },
  {
    id: 'lavender-dream',
    name: 'Lavender Dream',
    blurb: 'Pastel violet clouds, frosted and floaty',
    values: {
      mode: 'light',
      accent: '#8a6bff',
      accent2: '#ff8fb1',
      tint: 70,
      background: 'mesh',
      surface: 'frosted',
      buttonStyle: 'soft',
      radius: 22
    }
  },
  {
    id: 'midnight-mono',
    name: 'Midnight Mono',
    blurb: 'Quiet greyscale, no frills',
    values: {
      accent: '#e8e8ec',
      accent2: '#8a8a96',
      tint: 0,
      background: 'solid',
      surface: 'solid',
      buttonShape: 'square',
      buttonStyle: 'solid',
      radius: 4,
      font: 'system',
      glow: 0,
      particles: 'off'
    }
  }
]

export function presetAppearance(preset: Preset): Appearance {
  return { ...DEFAULT_APPEARANCE, ...preset.values }
}

/** The preset these settings match exactly, if any. */
export function matchingPreset(appearance: Appearance): Preset | undefined {
  const keys = Object.keys(DEFAULT_APPEARANCE) as Array<keyof Appearance>
  return PRESETS.find(preset => {
    const candidate = presetAppearance(preset)
    return keys.every(key => candidate[key] === appearance[key])
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function pick<T extends readonly string[]>(options: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? value : fallback
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : fallback
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** Validates saved or pasted settings; anything unknown or out of range falls back to the default. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const v = isRecord(raw) ? raw : {}
  const d = DEFAULT_APPEARANCE
  return {
    mode: pick(MODES, v.mode, d.mode),
    accent: isHex(v.accent) ? v.accent.toLowerCase() : d.accent,
    accent2: isHex(v.accent2) ? v.accent2.toLowerCase() : d.accent2,
    tint: number(v.tint, 0, 100, d.tint),
    background: pick(BACKGROUNDS, v.background, d.background),
    backgroundBlur: number(v.backgroundBlur, 0, 40, d.backgroundBlur),
    backgroundDim: number(v.backgroundDim, 0, 90, d.backgroundDim),
    animatedBackground: bool(v.animatedBackground, d.animatedBackground),
    surface: pick(SURFACES, v.surface, d.surface),
    glassBlur: number(v.glassBlur, 0, 48, d.glassBlur),
    glassOpacity: number(v.glassOpacity, 10, 95, d.glassOpacity),
    buttonShape: pick(BUTTON_SHAPES, v.buttonShape, d.buttonShape),
    buttonStyle: pick(BUTTON_STYLES, v.buttonStyle, d.buttonStyle),
    radius: number(v.radius, 0, 28, d.radius),
    font: pick(FONTS, v.font, d.font),
    uiScale: number(v.uiScale, 80, 130, d.uiScale),
    glow: number(v.glow, 0, 200, d.glow),
    // Settings saved before there was a choice had only sakura on/off (`sakura`) and its count (`petals`).
    particles: pick(PARTICLES, v.particles, v.sakura === false ? 'off' : d.particles),
    particleCount: number(v.particleCount ?? v.petals, 4, 40, d.particleCount),
    mascotMotion: bool(v.mascotMotion, d.mascotMotion),
    splash: bool(v.splash, d.splash)
  }
}

const randomOf = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]

/** A random but coherent look: complementary-ish accents and a mix of styles. */
export function randomAppearance(): Appearance {
  const hue = Math.random() * 360
  const mode = Math.random() < 0.75 ? 'dark' : 'light'
  return sanitizeAppearance({
    ...DEFAULT_APPEARANCE,
    mode,
    accent: rgbToHex(hslToRgb([hue, 90, mode === 'dark' ? 64 : 52])),
    accent2: rgbToHex(hslToRgb([hue + 110 + Math.random() * 100, 85, mode === 'dark' ? 66 : 58])),
    tint: 25 + Math.round(Math.random() * 50),
    background: randomOf(BACKGROUNDS.filter(b => b !== 'image')),
    surface: randomOf(SURFACES),
    buttonShape: randomOf(BUTTON_SHAPES),
    buttonStyle: randomOf(BUTTON_STYLES),
    radius: randomOf([4, 10, 16, 22]),
    font: randomOf(FONTS),
    glow: randomOf([40, 100, 160]),
    particles: randomOf(PARTICLES)
  })
}

const FONT_STACKS: Record<Appearance['font'], [body: string, display: string]> = {
  rounded: [
    "'Nunito', 'M PLUS Rounded 1c', 'Segoe UI', system-ui, sans-serif",
    "'M PLUS Rounded 1c', 'Nunito', system-ui, sans-serif"
  ],
  system: [
    "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
  ],
  serif: ["Georgia, 'Palatino Linotype', 'Times New Roman', serif", "Georgia, 'Palatino Linotype', serif"],
  mono: [
    "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"
  ]
}

const BUTTON_RADII: Record<Appearance['buttonShape'], string> = { pill: '999px', rounded: '12px', square: '4px' }

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

export interface ThemeOutput {
  /** CSS custom properties for :root. */
  tokens: Record<string, string>
  /** data-* attributes for <html>, read by theme.css. */
  attributes: Record<string, string>
  /** For the native window title bar overlay. */
  titleBar: { color: string; symbolColor: string }
}

/** Turns settings into CSS tokens. Pure, so it is unit-tested; applyTheme() writes the result to the DOM. */
export function computeTheme(a: Appearance): ThemeOutput {
  const accent = hexToRgb(a.accent)
  const accent2 = hexToRgb(a.accent2)
  const [hue2, sat2, light2] = rgbToHsl(accent2)
  const tint = a.tint
  const dark = a.mode === 'dark'

  const hsl = (s: number, l: number, hue = hue2) => hslToRgb([hue, s, l])
  const bg = dark ? hsl(tint, 7) : hsl(tint * 0.9, 96)
  const bg2 = dark ? hsl(tint + 3, 10) : hsl(tint, 93)
  const surface = dark ? hsl(tint - 3, 14) : hsl(tint, 99)
  const surfaceRaised = dark ? hsl(tint - 3, 20) : hsl(tint * 0.9, 91)
  const text = dark ? hsl(Math.min(100, tint * 2.2), 97) : hsl(tint * 0.8, 12)
  const textBase = dark ? hsl(Math.min(100, tint * 2.2), 95) : hsl(tint * 0.7, 18)
  const tintColor = dark ? hsl(Math.max(tint, 20) * 2.2, 86) : hsl(Math.max(tint, 20), 40)
  const ink = dark ? WHITE : hsl(tint * 0.6, 12)
  const gradientMid = mix(accent, accent2, 0.5)
  const gradientEnd = hslToRgb([hue2 - 25, sat2, light2])
  const glow = a.glow / 100
  const surfaceAlpha = a.surface === 'frosted' ? Math.min(95, a.glassOpacity + 20) : a.glassOpacity
  const surfaceBlur = a.surface === 'frosted' ? a.glassBlur * 1.8 : a.glassBlur

  const tokens: Record<string, string> = {
    '--bg-rgb': channels(bg),
    '--surface-rgb': channels(surface),
    '--surface-raised-rgb': channels(surfaceRaised),
    '--accent-rgb': channels(accent),
    '--accent-2-rgb': channels(accent2),
    '--accent-soft-rgb': channels(dark ? mix(accent, WHITE, 0.32) : accent),
    '--tint-rgb': channels(tintColor),
    '--text-rgb': channels(textBase),
    '--ink-rgb': channels(ink),
    '--bg': rgbToHex(bg),
    '--bg-2': rgbToHex(bg2),
    '--surface': rgbToHex(surface),
    '--surface-raised': rgbToHex(surfaceRaised),
    '--text': rgbToHex(text),
    '--accent': rgbToHex(accent),
    '--accent-2': rgbToHex(accent2),
    '--accent-3': rgbToHex(gradientEnd),
    '--accent-light': rgbToHex(dark ? mix(accent, WHITE, 0.5) : mix(accent, BLACK, 0.25)),
    '--on-accent': rgbToHex(onColor(accent)),
    '--petal-light': rgbToHex(mix(accent, WHITE, 0.85)),
    '--hero-a': rgbToHex(dark ? hsl(Math.max(tint, 10) + 5, 15) : hsl(Math.max(tint, 10) + 20, 94)),
    '--hero-b': rgbToHex(dark ? hsl(Math.max(tint, 10) + 12, 20) : hsl(Math.max(tint, 10) + 25, 89)),
    '--hero-c': rgbToHex(mix(dark ? hsl(Math.max(tint, 10), 18) : hsl(Math.max(tint, 10) + 20, 90), accent, 0.15)),
    '--gradient': `linear-gradient(120deg, ${rgbToHex(accent)} 0%, ${rgbToHex(gradientMid)} 55%, ${rgbToHex(gradientEnd)} 100%)`,
    '--glow':
      glow > 0
        ? `0 0 ${Math.round(24 * glow)}px rgb(${channels(accent)} / ${Math.min(0.8, 0.35 * glow).toFixed(2)})`
        : 'none',
    '--radius': `${a.radius}px`,
    '--btn-radius': BUTTON_RADII[a.buttonShape],
    '--font-body': FONT_STACKS[a.font][0],
    '--font-display': FONT_STACKS[a.font][1],
    '--panel-alpha': (surfaceAlpha / 100).toFixed(2),
    '--panel-blur': `${Math.round(surfaceBlur)}px`,
    '--bg-blur': `${a.backgroundBlur}px`,
    '--bg-dim': (a.backgroundDim / 100).toFixed(2)
  }

  const attributes: Record<string, string> = {
    'data-mode': a.mode,
    'data-bg': a.background,
    'data-bg-motion': a.animatedBackground ? 'on' : 'off',
    'data-surface': a.surface,
    'data-btn-shape': a.buttonShape,
    'data-btn-style': a.buttonStyle,
    'data-motion': a.mascotMotion ? 'on' : 'off'
  }

  return { tokens, attributes, titleBar: { color: rgbToHex(bg), symbolColor: rgbToHex(text) } }
}
