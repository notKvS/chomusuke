import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { ChomusukeApi, TorrentStats, UpdateState } from '../shared/types'

// The renderer only gets these narrow functions — never ipcRenderer itself.
const api: ChomusukeApi = {
  loadSource: (source, hints) => ipcRenderer.invoke('source:load', source, hints),
  openSong: song => ipcRenderer.invoke('source:open-song', song),
  openTorrentFile: () => ipcRenderer.invoke('source:open-file'),
  search: query => ipcRenderer.invoke('search:query', query),
  searchMore: (sourceId, query, page) => ipcRenderer.invoke('search:more', sourceId, query, page),
  openResult: albumId => ipcRenderer.invoke('search:open', albumId),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  saveTorznab: form => ipcRenderer.invoke('providers:save-torznab', form),
  testTorznab: form => ipcRenderer.invoke('providers:test-torznab', form),
  setProviderEnabled: (id, enabled) => ipcRenderer.invoke('providers:set-enabled', id, enabled),
  removeProvider: id => ipcRenderer.invoke('providers:remove', id),
  reorderProviders: ids => ipcRenderer.invoke('providers:reorder', ids),
  importPlugins: (repositoryUrl, kind) => ipcRenderer.invoke('plugins:import', repositoryUrl, kind),
  setPluginOptions: (id, values) => ipcRenderer.invoke('plugins:set-options', id, values),
  testPlugin: id => ipcRenderer.invoke('plugins:test', id),
  passPluginBotCheck: id => ipcRenderer.invoke('plugins:pass-bot-check', id),
  exploreSources: () => ipcRenderer.invoke('explore:sources'),
  browse: (sourceId, categoryId, page, region) =>
    ipcRenderer.invoke('explore:browse', sourceId, categoryId, page, region),
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
  setNowPlaying: nowPlaying => ipcRenderer.invoke('presence:set', nowPlaying),
  getDiscordStatus: () => ipcRenderer.invoke('presence:status'),
  recordPlay: song => ipcRenderer.invoke('history:record', song),
  getHistorySize: () => ipcRenderer.invoke('history:size'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  getHomeShelves: () => ipcRenderer.invoke('home:shelves'),
  getSimilarSongs: artistMbid => ipcRenderer.invoke('home:similar', artistMbid),
  getRadioSongs: ended => ipcRenderer.invoke('radio:next', ended),
  getRatings: () => ipcRenderer.invoke('ratings:list'),
  rateTrack: (infoHash, key, rating) => ipcRenderer.invoke('ratings:set', infoHash, key, rating),
  exportBackup: appearance => ipcRenderer.invoke('backup:export', appearance),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  getPlaylists: () => ipcRenderer.invoke('playlists:list'),
  createPlaylist: name => ipcRenderer.invoke('playlists:create', name),
  renamePlaylist: (id, name) => ipcRenderer.invoke('playlists:rename', id, name),
  deletePlaylist: id => ipcRenderer.invoke('playlists:delete', id),
  addToPlaylist: (id, infoHash, key) => ipcRenderer.invoke('playlists:add', id, infoHash, key),
  addSongsToPlaylist: (id, songs) => ipcRenderer.invoke('playlists:add-songs', id, songs),
  removeFromPlaylist: (id, songId) => ipcRenderer.invoke('playlists:remove', id, songId),
  moveInPlaylist: (id, from, to) => ipcRenderer.invoke('playlists:move', id, from, to),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  log: (level, message) => ipcRenderer.send('logs:write', level, message),
  getLyrics: query => ipcRenderer.invoke('lyrics:get', query),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  reportCrash: details => ipcRenderer.invoke('crash:report', details),
  platform: process.platform,
  windowControl: action => ipcRenderer.invoke('window:control', action),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: listener => {
    const handler = (_event: IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  onStats: listener => {
    const handler = (_event: IpcRendererEvent, stats: TorrentStats[]) => listener(stats)
    ipcRenderer.on('torrent:stats', handler)
    return () => ipcRenderer.removeListener('torrent:stats', handler)
  },
  onUpdateState: listener => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  }
}

contextBridge.exposeInMainWorld('chomusuke', api)
