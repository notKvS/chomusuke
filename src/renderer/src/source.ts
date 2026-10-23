/** Whether top-bar input should be loaded as a torrent rather than searched for. Main re-validates it. */
export function looksLikeSource(value: string): boolean {
  const text = value.trim()
  return /^magnet:\?/i.test(text) || /^[a-f0-9]{40}$/i.test(text) || /^https?:\/\//i.test(text)
}
