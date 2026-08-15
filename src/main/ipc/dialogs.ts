import { IPC_CHANNELS } from '../../shared/constants'

export type DirectoryDialogResult = {
  canceled: boolean
  filePaths: string[]
}

export type DirectorySelection = {
  canceled: boolean
  path?: string
}

type NativeOpenDialogOptions =
  | { properties: ['openDirectory'] }
  | { properties: ['openFile']; filters: Array<{ name: string; extensions: string[] }> }

type IpcMainLike = {
  handle(channel: string, listener: () => Promise<DirectorySelection>): void
}

type ShowOpenDialog = (options: NativeOpenDialogOptions) => Promise<DirectoryDialogResult>

export const ZIP_FILE_DIALOG_OPTIONS = {
  properties: ['openFile'] as ['openFile'],
  filters: [{ name: 'ZIP files', extensions: ['zip'] }],
}

export function mapDirectorySelection(result: DirectoryDialogResult): DirectorySelection {
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
}

export function mapZipFileSelection(result: DirectoryDialogResult): DirectorySelection {
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
}

export function registerDirectoryDialogHandler(ipcMain: IpcMainLike, showOpenDialog: ShowOpenDialog): void {
  ipcMain.handle(IPC_CHANNELS.dialogSelectDirectory, async () => {
    return mapDirectorySelection(await showOpenDialog({ properties: ['openDirectory'] }))
  })
}

export function registerZipFileDialogHandler(ipcMain: IpcMainLike, showOpenDialog: ShowOpenDialog): void {
  ipcMain.handle(IPC_CHANNELS.dialogSelectZipFile, async () => {
    return mapZipFileSelection(await showOpenDialog(ZIP_FILE_DIALOG_OPTIONS))
  })
}
