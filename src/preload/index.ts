import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
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
  setWindowAppearance: appearance => ipcRenderer.invoke('ui:set-window-appearance', appearance),
  getTorrentDetails: infoHash => ipcRenderer.invoke('torrent:details', infoHash),
  saveTorrentFile: infoHash => ipcRenderer.invoke('torrent:save-file', infoHash),
  copyMagnet: infoHash => ipcRenderer.invoke('torrent:copy-magnet', infoHash),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  keepAlbum: (infoHash, info) => ipcRenderer.invoke('library:keep', infoHash, info),
  removeFromLibrary: infoHash => ipcRenderer.invoke('library:remove', infoHash),
  clearStreamed: () => ipcRenderer.invoke('library:clear-streamed'),
  openLibraryAlbum: infoHash => ipcRenderer.invoke('library:open', infoHash),
  setSharing: settings => ipcRenderer.invoke('sharing:set', settings),
  onStats: listener => {
    const handler = (_event: IpcRendererEvent, stats: TorrentStats[]) => listener(stats)
    ipcRenderer.on('torrent:stats', handler)
    return () => ipcRenderer.removeListener('torrent:stats', handler)
  }
}

contextBridge.exposeInMainWorld('chomusuke', api)
