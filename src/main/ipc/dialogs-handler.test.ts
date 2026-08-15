import { describe, expect, it, vi } from 'vitest'
import { registerDirectoryDialogHandler, registerZipFileDialogHandler } from './dialogs'

describe('registerDirectoryDialogHandler', () => {
  it('opens a native directory-only dialog and maps its first selection', async () => {
    const handle = vi.fn()
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['D:\\projects\\alpha'] })

    registerDirectoryDialogHandler({ handle }, showOpenDialog)

    expect(handle).toHaveBeenCalledWith('dialog:select-directory', expect.any(Function))
    const listener = handle.mock.calls[0][1]
    await expect(listener()).resolves.toEqual({ canceled: false, path: 'D:\\projects\\alpha' })
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
  })
})

describe('registerZipFileDialogHandler', () => {
  it('opens a native ZIP-only file dialog and maps its first selection', async () => {
    const handle = vi.fn()
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['D:\\downloads\\skills.zip'] })

    registerZipFileDialogHandler({ handle }, showOpenDialog)

    expect(handle).toHaveBeenCalledWith('dialog:select-zip-file', expect.any(Function))
    const listener = handle.mock.calls[0][1]
    await expect(listener()).resolves.toEqual({ canceled: false, path: 'D:\\downloads\\skills.zip' })
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'ZIP files', extensions: ['zip'] }],
    })
  })
})
