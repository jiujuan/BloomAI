import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'

contextBridge.exposeInMainWorld('bloomai', {
  // Clipboard
  readClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardRead),
  writeClipboard: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.clipboardWrite, text),

  // Window management
  getActiveWindow: () => ipcRenderer.invoke(IPC_CHANNELS.appGetActiveWindow),
  closeOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.windowCloseOverlay),
  openMain: () => ipcRenderer.invoke(IPC_CHANNELS.windowOpenMain),

  // App info
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.shellOpenExternal, url),

  // Dialog
  saveImage: (srcUrl: string, defaultName: string) => ipcRenderer.invoke(IPC_CHANNELS.saveImage, srcUrl, defaultName),
})
