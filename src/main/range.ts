export interface ByteRange {
  start: number
  /** Inclusive */
  end: number
}

/**
 * Parses a single-part HTTP Range header (RFC 9110 §14).
 * Returns null when the header is absent or should be ignored (serve the whole file),
 * or 'unsatisfiable' when a 416 is appropriate.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return null
  return { start, end }
}
