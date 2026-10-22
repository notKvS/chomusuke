import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChomusukeApi, TorrentStats } from '../shared/types'

// The renderer only gets these three narrow functions — never ipcRenderer itself.
const api: ChomusukeApi = {
  loadSource: (source, hints) => ipcRenderer.invoke('source:load', source, hints),
  openTorrentFile: () => ipcRenderer.invoke('source:open-file'),
  onStats: listener => {
    const handler = (_event: IpcRendererEvent, stats: TorrentStats[]) => listener(stats)
    ipcRenderer.on('torrent:stats', handler)
    return () => ipcRenderer.removeListener('torrent:stats', handler)
  }
}

contextBridge.exposeInMainWorld('chomusuke', api)
