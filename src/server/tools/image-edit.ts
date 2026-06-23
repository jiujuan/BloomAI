import type { ToolExecutor } from './types'

export const imageEditTool: ToolExecutor = async () => ({ note: 'Image editing requires sharp - install separately' })
