export const IPC_CHANNELS = {
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  appGetActiveWindow: 'app:get-active-window',
  windowCloseOverlay: 'window:close-overlay',
  windowOpenMain: 'window:open-main',
  appVersion: 'app:version',
  shellOpenExternal: 'shell:open-external',
  saveImage: 'dialog:save-image',
  dialogSelectDirectory: 'dialog:select-directory',
  dialogSelectZipFile: 'dialog:select-zip-file',
  toolRequestApproval: 'tool:request-approval',
} as const
