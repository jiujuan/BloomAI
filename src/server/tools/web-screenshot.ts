import type { ToolExecutor } from './types'
import { requireToolAvailability } from './availability'

export const webScreenshotTool: ToolExecutor = async () => {
  requireToolAvailability('web_screenshot')
  return {}
}
