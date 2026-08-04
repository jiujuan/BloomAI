import { describe, expect, it } from 'vitest'
import { getToolAvailability, ToolUnavailableError } from './availability'
import { ocrTool } from './ocr'

describe('ocr availability boundary', () => {
  it('reports the missing backend as a structured unavailable state', () => {
    expect(getToolAvailability('ocr')).toEqual({
      status: 'dependency_missing',
      dependency: 'ocr-backend',
      reason: expect.any(String),
    })
  })

  it('rejects instead of returning a successful placeholder result', async () => {
    let returned = false
    try {
      await ocrTool(
        { imagePath: 'C:\\approved\\image.png', lang: 'eng' },
        { toolId: 'ocr', caller: 'http' },
      )
      returned = true
    } catch (error) {
      expect(error).toBeInstanceOf(ToolUnavailableError)
      expect(error).toMatchObject({
        toolId: 'ocr',
        availability: {
          status: 'dependency_missing',
          dependency: 'ocr-backend',
        },
      })
    }
    expect(returned).toBe(false)
  })
})
