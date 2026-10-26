import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { type Appearance, DEFAULT_APPEARANCE } from './appearance.ts'
import { applyTheme, loadAppearance, loadBackgroundImage, saveAppearance, saveBackgroundImage } from './dom.ts'

/** Live appearance settings: applied to the DOM on every change and remembered across launches. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance)
  const [image, setImageState] = useState<string | null>(loadBackgroundImage)

  useLayoutEffect(() => {
    const theme = applyTheme(appearance, image)
    void window.chomusuke.setWindowAppearance({
      zoom: appearance.uiScale / 100,
      titleBarColor: theme.titleBar.color,
      titleBarSymbolColor: theme.titleBar.symbolColor
    })
  }, [appearance, image])

  useEffect(() => saveAppearance(appearance), [appearance])

  const update = useCallback((patch: Partial<Appearance>) => setAppearance(prev => ({ ...prev, ...patch })), [])
  const replace = useCallback((next: Appearance) => setAppearance(next), [])
  const reset = useCallback(() => setAppearance(DEFAULT_APPEARANCE), [])

  /** Returns false if the image couldn't be stored (it still shows for this session). */
  const setImage = useCallback((next: string | null): boolean => {
    setImageState(next)
    return saveBackgroundImage(next)
  }, [])

  return { appearance, update, replace, reset, image, setImage }
}

export type AppearanceControls = ReturnType<typeof useAppearance>
