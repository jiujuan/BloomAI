import type { ToolExecutor } from './types'

export const webScreenshotTool: ToolExecutor = async () => ({ note: 'Screenshot requires Playwright - install separately' })
