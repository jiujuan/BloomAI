import type { ToolExecutor } from './types'
import { requireToolAvailability } from './availability'

export const imageEditTool: ToolExecutor = async () => {
  requireToolAvailability('image_edit')
  return {}
}
