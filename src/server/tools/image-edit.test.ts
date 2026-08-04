import { describe, expect, it } from 'vitest'
import { getToolAvailability, ToolUnavailableError } from './availability'
import { imageEditTool } from './image-edit'

describe('image edit availability boundary', () => {
  it('reports the missing backend as a structured unavailable state', () => {
    expect(getToolAvailability('image_edit')).toEqual({
      status: 'dependency_missing',
      dependency: 'image-processing-backend',
      reason: expect.any(String),
    })
  })

  it('rejects instead of returning a successful placeholder result', async () => {
    let returned = false
    try {
      await imageEditTool(
        {
          path: 'C:\\approved\\input.png',
          ops: [{ type: 'resize', width: 800, height: 600 }],
          outputPath: 'C:\\approved\\output.png',
        },
        { toolId: 'image_edit', caller: 'http' },
      )
      returned = true
    } catch (error) {
      expect(error).toBeInstanceOf(ToolUnavailableError)
      expect(error).toMatchObject({
        toolId: 'image_edit',
        availability: {
          status: 'dependency_missing',
          dependency: 'image-processing-backend',
        },
      })
    }
    expect(returned).toBe(false)
  })
})
