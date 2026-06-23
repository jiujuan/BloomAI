import type { ToolExecutor } from './types'

export const docDocxTool: ToolExecutor = async () => ({ note: 'DOCX parsing requires mammoth - install separately' })
