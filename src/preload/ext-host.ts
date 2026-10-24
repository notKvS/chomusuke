import { contextBridge, ipcRenderer } from 'electron'

// Bridge for the hidden extension-host page only: receive the extension's code and calls, send replies.
contextBridge.exposeInMainWorld('chomusukeHost', {
  onLoad: (listener: (payload: { code: string; hosts: string[] }) => void) =>
    ipcRenderer.on('ext:load', (_event, payload: { code: string; hosts: string[] }) => listener(payload)),
  onCall: (listener: (message: unknown) => void) => ipcRenderer.on('ext:call', (_event, message: unknown) => listener(message)),
  reply: (message: unknown) => ipcRenderer.send('ext:reply', message)
})
