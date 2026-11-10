import { useEffect, useState } from 'react'
import type { Appearance } from './theme/appearance'
import { imagePixels } from './theme/dom'
import { panelColoursFromPixels } from './theme/imagePalette'

export interface Tint {
  from: string
  to: string
}

const MAX_REMEMBERED = 60
const remembered = new Map<string, Tint | null>()

/**
 * Soft background colours taken from an album cover, for a panel that sits beside it. Null while they're being worked
 * out, when there is no cover, or when the cover can't be read or has no real colour (greys): the panel then keeps
 * the theme's own background.
 */
export function useCoverTint(coverUrl: string | undefined, mode: Appearance['mode'], enabled: boolean): Tint | null {
  const [tint, setTint] = useState<Tint | null>(null)

  useEffect(() => {
    if (!enabled || !coverUrl) return setTint(null)
    const key = `${mode}|${coverUrl}`
    if (remembered.has(key)) return setTint(remembered.get(key) ?? null)
    let current = true
    imagePixels(coverUrl)
      .then(pixels => panelColoursFromPixels(pixels, mode))
      .catch(() => null)
      .then(found => {
        remembered.set(key, found)
        if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value as string)
        if (current) setTint(found)
      })
    return () => {
      current = false
    }
  }, [coverUrl, mode, enabled])

  return tint
}
