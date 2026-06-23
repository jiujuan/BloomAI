import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bloomai', {
  // Clipboard
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),

  // Window management
  getActiveWindow: () => ipcRenderer.invoke('app:get-active-window'),
  closeOverlay: () => ipcRenderer.invoke('window:close-overlay'),
  openMain: () => ipcRenderer.invoke('window:open-main'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
})
