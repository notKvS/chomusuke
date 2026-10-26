// Browser side of the theme: writes computed tokens to <html>, and persists settings and the custom background
// image in localStorage (per user, on this machine).
import {
  type Appearance,
  computeTheme,
  DEFAULT_APPEARANCE,
  sanitizeAppearance,
  type ThemeOutput
} from './appearance.ts'

/** Writes the theme to <html>. `image` is the custom background (a data: URL) or null. */
export function applyTheme(
  a: Appearance,
  image: string | null,
  root: HTMLElement = document.documentElement
): ThemeOutput {
  const theme = computeTheme(a)
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(name, value)
  for (const [name, value] of Object.entries(theme.attributes)) root.setAttribute(name, value)
  if (image && a.background === 'image') root.style.setProperty('--bg-image', `url("${image}")`)
  else root.style.removeProperty('--bg-image')
  return theme
}

const STORAGE_KEY = 'chomusuke.appearance'
const IMAGE_KEY = 'chomusuke.background-image'
const IMAGE_PREFIX = 'data:image/jpeg;base64,'

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeAppearance(JSON.parse(raw)) : DEFAULT_APPEARANCE
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  } catch {
    // Persisting is a convenience; the theme still applies for this session.
  }
}

/** Only images we encoded ourselves (JPEG data URLs) are accepted back from storage. */
export function isBackgroundImage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(IMAGE_PREFIX) &&
    /^[A-Za-z0-9+/=]+$/.test(value.slice(IMAGE_PREFIX.length))
  )
}

export function loadBackgroundImage(): string | null {
  try {
    const value = localStorage.getItem(IMAGE_KEY)
    return isBackgroundImage(value) ? value : null
  } catch {
    return null
  }
}

/** Returns false when the image doesn't fit in storage. */
export function saveBackgroundImage(image: string | null): boolean {
  try {
    if (image) localStorage.setItem(IMAGE_KEY, image)
    else localStorage.removeItem(IMAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Downscales a picked image file to at most 1920×1200 and re-encodes it as JPEG. */
export async function encodeBackgroundImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image.')
  if (file.size > 40 * 1024 * 1024) throw new Error('That image is too large (40 MB max).')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That image couldn’t be read.')
  })
  const scale = Math.min(1, 1920 / bitmap.width, 1200 / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}
