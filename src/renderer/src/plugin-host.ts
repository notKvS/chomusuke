// Runs inside the hidden, sandboxed plugin window. It never executes plugin code itself:
// the code is loaded into a module Web Worker, and this page only relays messages.

interface HostBridge {
  onLoad(listener: (payload: { code: string; hosts: string[] }) => void): void
  onCall(listener: (message: unknown) => void): void
  reply(message: unknown): void
}

const bridge = (window as unknown as { chomusukeHost: HostBridge }).chomusukeHost
const MAX_REPLY_CHARS = 1_000_000
const HOST = /^(\*\.)?[a-z0-9.-]+$/

const runner = (codeUrl: string) => `
const send = message => self.postMessage(message)
const errorText = error => String((error && error.message) || error).slice(0, 300)
let plugin
try {
  plugin = (await import(${JSON.stringify(codeUrl)})).default
  if (!plugin || (typeof plugin.search !== 'function' && typeof plugin.browse !== 'function'))
    throw new Error('The plugin has no search() or browse() function.')
} catch (error) {
  send({ id: 0, ok: false, error: errorText(error) })
  throw error
}
self.onmessage = async ({ data }) => {
  const { id, method, args } = data
  try {
    if (method === 'test' && typeof plugin.test !== 'function') return send({ id, ok: true, value: true })
    if (typeof plugin[method] !== 'function') throw new Error(method + '() is not supported.')
    send({ id, ok: true, value: await plugin[method](args) })
  } catch (error) {
    send({ id, ok: false, error: errorText(error) })
  }
}
send({ id: 0, ok: true })
`

let worker: Worker | null = null
/** Ids we relayed to the worker and haven't answered yet; anything else from the worker is dropped. */
const outstanding = new Set<number>()
let loaded = false

function forward(message: unknown): void {
  if (typeof message !== 'object' || message === null) return
  const id = (message as { id?: unknown }).id
  if (id === 0) {
    if (loaded) return
    loaded = true
  } else if (typeof id !== 'number' || !outstanding.delete(id)) {
    return
  }
  let size = Infinity
  try {
    size = JSON.stringify(message).length
  } catch {
    // not serialisable → treated as too large
  }
  bridge.reply(size <= MAX_REPLY_CHARS ? message : { id, ok: false, error: 'The plugin returned too much data.' })
}

bridge.onLoad(({ code, hosts }) => {
  if (worker) return
  // Narrow the page CSP (inherited by the worker) to the declared hosts as well; the session enforces the same.
  const sources = hosts.filter(h => HOST.test(h)).map(h => `https://${h}`)
  const csp = document.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = `connect-src ${sources.join(' ') || "'none'"}`
  document.head.append(csp)

  const codeUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const runnerUrl = URL.createObjectURL(new Blob([runner(codeUrl)], { type: 'text/javascript' }))
  worker = new Worker(runnerUrl, { type: 'module' })
  worker.onmessage = event => forward(event.data)
  worker.onerror = event => forward({ id: 0, ok: false, error: event.message || 'The plugin failed to load.' })
})

bridge.onCall(message => {
  const id = (message as { id?: unknown }).id
  if (!worker || typeof id !== 'number') return
  outstanding.add(id)
  worker.postMessage(message)
})
