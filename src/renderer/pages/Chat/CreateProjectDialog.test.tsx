import { describe, expect, it } from 'vitest'
import { directoryBaseName, directoryValueAfterSelection, isValidProjectName } from './CreateProjectDialog'

describe('CreateProjectDialog helpers', () => {
  it('validates trimmed names in the one-to-eighty-character range', () => {
    expect(isValidProjectName('  项目  ')).toBe(true)
    expect(isValidProjectName('   ')).toBe(false)
    expect(isValidProjectName('x'.repeat(80))).toBe(true)
    expect(isValidProjectName('x'.repeat(81))).toBe(false)
  })

  it('shows a cross-platform directory basename and retains the previous selection on cancel', () => {
    expect(directoryBaseName('D:\\work\\alpha\\')).toBe('alpha')
    expect(directoryBaseName('/tmp/alpha/')).toBe('alpha')
    expect(directoryValueAfterSelection('D:/current', { canceled: true })).toBe('D:/current')
    expect(directoryValueAfterSelection('D:/current', { canceled: false, path: 'D:/next' })).toBe('D:/next')
  })
})
