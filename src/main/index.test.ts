import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/constants'

const handle = vi.fn()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
    getVersion: vi.fn(() => '0.0.0'),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => undefined),
    getAllWindows: vi.fn(() => []),
  },
  Tray: vi.fn(),
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn(), createEmpty: vi.fn() },
  ipcMain: { handle },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
  dialog: { showOpenDialog, showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
}))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('main native dialog registration', () => {
  it('registers the directory picker in the application IPC setup', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\skills'] })
    const { setupIPC } = await import('./index')

    setupIPC()

    const directoryHandlerCalls = handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.dialogSelectDirectory)
    expect(directoryHandlerCalls).toHaveLength(1)
    const directoryHandler = directoryHandlerCalls[0]?.[1]
    expect(directoryHandler).toEqual(expect.any(Function))
    await expect(directoryHandler()).resolves.toEqual({ canceled: false, path: 'D:\\skills' })
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
  })

  it('registers the ZIP file picker in the application IPC setup', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\downloads\\skills.zip'] })
    const { setupIPC } = await import('./index')

    setupIPC()

    const zipHandlerCalls = handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.dialogSelectZipFile)
    expect(zipHandlerCalls).toHaveLength(1)
    const zipHandler = zipHandlerCalls[0]?.[1]
    expect(zipHandler).toEqual(expect.any(Function))
    await expect(zipHandler()).resolves.toEqual({ canceled: false, path: 'D:\\downloads\\skills.zip' })
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'ZIP files', extensions: ['zip'] }],
    })
  })
})
