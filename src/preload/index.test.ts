import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/constants'

const exposeInMainWorld = vi.fn()
const invoke = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
}))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('preload native dialog bridge', () => {
  it('exposes selectDirectory and forwards it to the directory dialog IPC channel', async () => {
    invoke.mockResolvedValue({ canceled: false, path: 'D:\\skills' })

    await import('./index')

    expect(exposeInMainWorld).toHaveBeenCalledWith('bloomai', expect.objectContaining({
      selectDirectory: expect.any(Function),
    }))
    const bridge = exposeInMainWorld.mock.calls[0][1] as { selectDirectory: () => Promise<{ canceled: boolean; path?: string }> }
    await expect(bridge.selectDirectory()).resolves.toEqual({ canceled: false, path: 'D:\\skills' })
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dialogSelectDirectory)
  })

  it('exposes selectZipFile and forwards it to the ZIP file dialog IPC channel', async () => {
    invoke.mockResolvedValue({ canceled: false, path: 'D:\\downloads\\skills.zip' })

    await import('./index')

    expect(exposeInMainWorld).toHaveBeenCalledWith('bloomai', expect.objectContaining({
      selectZipFile: expect.any(Function),
    }))
    const bridge = exposeInMainWorld.mock.calls[0][1] as { selectZipFile: () => Promise<{ canceled: boolean; path?: string }> }
    await expect(bridge.selectZipFile()).resolves.toEqual({ canceled: false, path: 'D:\\downloads\\skills.zip' })
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dialogSelectZipFile)
  })
})
