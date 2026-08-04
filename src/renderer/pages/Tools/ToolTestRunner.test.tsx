import { describe, expect, it, vi } from 'vitest'
import { canRunTool } from './tool-ui-state'
import { getScreenshotArtifactView } from '@renderer/pages/Chat/parts/tool-part'

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

  it('accepts only controlled screenshot artifact metadata for preview', () => {
    expect(getScreenshotArtifactView({
      runId: 'run-1',
      relativePath: 'tool-artifacts/web-screenshot/run-1/screenshot.png',
      mimeType: 'image/png',
      bytes: 123,
      width: 800,
      height: 600,
    })).toEqual({
      runId: 'run-1',
      relativePath: 'tool-artifacts/web-screenshot/run-1/screenshot.png',
      mimeType: 'image/png',
      bytes: 123,
      width: 800,
      height: 600,
    })
    expect(getScreenshotArtifactView({
      imagePath: 'C:\\private\\screenshot.png',
      mimeType: 'image/png',
    })).toBeUndefined()
  })
})
