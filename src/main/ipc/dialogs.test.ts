import { describe, expect, it } from 'vitest'
import { mapDirectorySelection } from './dialogs'

describe('mapDirectorySelection', () => {
  it('does not expose a path when the native dialog is cancelled', () => {
    expect(mapDirectorySelection({ canceled: true, filePaths: ['C:\\ignored'] })).toEqual({ canceled: true })
  })

  it('exposes only the first selected directory', () => {
    expect(mapDirectorySelection({ canceled: false, filePaths: ['D:\\projects\\alpha', 'D:\\projects\\beta'] })).toEqual({
      canceled: false,
      path: 'D:\\projects\\alpha',
    })
  })
})