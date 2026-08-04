import type { ToolExecutor } from './types'
import { requireToolAvailability } from './availability'

export const ocrTool: ToolExecutor = async () => {
  requireToolAvailability('ocr')
  return {}
}
