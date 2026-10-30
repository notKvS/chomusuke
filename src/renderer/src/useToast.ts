import { useEffect, useState } from 'react'

const TOAST_MS = 6000

/** One message at a time at the bottom of the window; it hides itself after a few seconds. */
export function useToast(): [toast: string | null, setToast: (message: string | null) => void] {
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  return [toast, setToast]
}
