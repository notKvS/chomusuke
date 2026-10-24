import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChomusukeApi, TorrentStats } from '../shared/types'

// The renderer only gets these narrow functions — never ipcRenderer itself.
const api: ChomusukeApi = {
  loadSource: (source, hints) => ipcRenderer.invoke('source:load', source, hints),
  openTorrentFile: () => ipcRenderer.invoke('source:open-file'),
  search: query => ipcRenderer.invoke('search:query', query),
  openResult: albumId => ipcRenderer.invoke('search:open', albumId),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  saveTorznab: form => ipcRenderer.invoke('providers:save-torznab', form),
  testTorznab: form => ipcRenderer.invoke('providers:test-torznab', form),
  setProviderEnabled: (id, enabled) => ipcRenderer.invoke('providers:set-enabled', id, enabled),
  removeProvider: id => ipcRenderer.invoke('providers:remove', id),
  importExtensions: repositoryUrl => ipcRenderer.invoke('extensions:import', repositoryUrl),
  setExtensionOptions: (id, values) => ipcRenderer.invoke('extensions:set-options', id, values),
  testExtension: id => ipcRenderer.invoke('extensions:test', id),
  exploreSources: () => ipcRenderer.invoke('explore:sources'),
  browse: (sourceId, categoryId) => ipcRenderer.invoke('explore:browse', sourceId, categoryId),
  onStats: listener => {
    const handler = (_event: IpcRendererEvent, stats: TorrentStats[]) => listener(stats)
    ipcRenderer.on('torrent:stats', handler)
    return () => ipcRenderer.removeListener('torrent:stats', handler)
  }
}

contextBridge.exposeInMainWorld('chomusuke', api)
