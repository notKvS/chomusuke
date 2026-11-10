/**
 * Request headers a plugin's own `fetch` isn't allowed to set (the browser decides them). A plugin asks for one by
 * sending it as `X-Plugin-<Name>` instead, e.g. `X-Plugin-User-Agent`; the sandbox's session swaps it in before the
 * request leaves. Only these three, and only on requests to the plugin's declared hosts.
 */
const SETTABLE = new Map([
  ['x-plugin-user-agent', 'User-Agent'],
  ['x-plugin-origin', 'Origin'],
  ['x-plugin-referer', 'Referer']
])
const VALUE = /^[\x20-\x7e]{1,500}$/

/**
 * The headers to send: our own page's Origin and Referer removed (an API can answer 403 to a foreign origin), then
 * the ones the plugin asked for put in their place.
 */
export function applyPluginHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const wanted: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    const replaces = SETTABLE.get(lower)
    if (replaces) {
      if (VALUE.test(value)) wanted[replaces] = value
    } else if (!lower.startsWith('x-plugin-') && !/^(origin|referer)$/i.test(name)) out[name] = value
  }
  // A requested User-Agent replaces the browser's, whatever case it came in.
  if (wanted['User-Agent']) for (const name of Object.keys(out)) if (/^user-agent$/i.test(name)) delete out[name]
  return { ...out, ...wanted }
}
