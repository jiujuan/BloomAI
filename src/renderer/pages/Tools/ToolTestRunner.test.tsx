import { describe, expect, it, vi } from 'vitest'
import { canRunTool } from './tool-ui-state'

describe('ToolTestRunner availability', () => {
  it('does not offer Run for an unavailable tool', () => {
    const tool = {
      id: 'ocr',
      is_enabled: 0,
      availability: {
        status: 'dependency_missing',
        dependency: 'ocr-backend',
        reason: 'OCR backend is not installed',
      },
    } as any

    expect(canRunTool(tool)).toEqual({
      allowed: false,
      reason: 'OCR backend is not installed',
    })
  })
})
