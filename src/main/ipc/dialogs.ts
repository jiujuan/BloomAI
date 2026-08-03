import { IPC_CHANNELS } from '../../shared/constants'

export type DirectoryDialogResult = {
  canceled: boolean
  filePaths: string[]
}

export type DirectorySelection = {
  canceled: boolean
  path?: string
}

type IpcMainLike = {
  handle(channel: string, listener: () => Promise<DirectorySelection>): void
}

type ShowOpenDialog = (options: { properties: string[] }) => Promise<DirectoryDialogResult>

export function mapDirectorySelection(result: DirectoryDialogResult): DirectorySelection {
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
}

export function registerDirectoryDialogHandler(ipcMain: IpcMainLike, showOpenDialog: ShowOpenDialog): void {
  ipcMain.handle(IPC_CHANNELS.dialogSelectDirectory, async () => {
    return mapDirectorySelection(await showOpenDialog({ properties: ['openDirectory'] }))
  })
}
