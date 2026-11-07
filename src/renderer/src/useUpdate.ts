import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/types'

/** The app's update state, kept current as the main process checks and downloads; null until first read. */
export function useUpdate(): UpdateState | null {
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => {
    let live = true
    const off = window.chomusuke.onUpdateState(setUpdate)
    void window.chomusuke.getUpdateState().then(state => live && setUpdate(state))
    return () => {
      live = false
      off()
    }
  }, [])

  return update
}
