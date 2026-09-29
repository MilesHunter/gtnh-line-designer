import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppApi,
  DownloadProgress,
  LocalImportProgress
} from '../shared/types'

const api: AppApi = {
  getDataStatus: () => ipcRenderer.invoke('data:status'),
  resolveAndDownload: (ref) => ipcRenderer.invoke('data:download', ref),
  cancelDownload: () => ipcRenderer.invoke('data:cancel'),
  selectVersion: (commit) => ipcRenderer.invoke('data:select', commit),
  chooseGameInstance: () => ipcRenderer.invoke('instance:choose'),
  refreshGameInstance: () => ipcRenderer.invoke('instance:refresh'),
  prepareNesqlExport: () => ipcRenderer.invoke('instance:prepare-export'),
  refreshExportSession: () => ipcRenderer.invoke('instance:refresh-export'),
  restoreGameInstance: () => ipcRenderer.invoke('instance:restore'),
  convertLocalExport: () => ipcRenderer.invoke('instance:convert-export'),
  cleanupLocalExport: () => ipcRenderer.invoke('instance:cleanup-export'),
  openGameDirectory: () => ipcRenderer.invoke('instance:open-folder'),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (content, path, saveAs) =>
    ipcRenderer.invoke('project:save', content, path, saveAs),
  autosaveProject: (content) => ipcRenderer.invoke('project:autosave', content),
  readAutosave: () => ipcRenderer.invoke('project:read-autosave'),
  exportPng: (bytes, suggestedName) =>
    ipcRenderer.invoke('project:export-png', bytes, suggestedName),
  getAppRoot: () => ipcRenderer.invoke('data:appRoot'),
  onDownloadProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void =>
      callback(progress)
    ipcRenderer.on('data:progress', listener)
    return () => ipcRenderer.removeListener('data:progress', listener)
  },
  onLocalImportProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: LocalImportProgress
    ): void => callback(progress)
    ipcRenderer.on('local-import:progress', listener)
    return () =>
      ipcRenderer.removeListener('local-import:progress', listener)
  }
}

contextBridge.exposeInMainWorld('gtnh', api)
