import type { ToolExecutor } from './types'

export const ocrTool: ToolExecutor = async () => ({ note: 'OCR requires Tesseract - install separately' })
