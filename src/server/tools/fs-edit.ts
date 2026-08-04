import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { ToolExecutor } from './types'
import { assertFileSizeWithinLimit, assertNotAborted, readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const fsEditTool: ToolExecutor<{ path: string; oldText: string; newText: string; expectedHash?: string }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'write')
  await assertFileSizeWithinLimit(filePath, context)
  const content = (await readTextFileLimited(filePath, context)).text
  assertNotAborted(context)
  if (input.expectedHash && sha256(content) !== input.expectedHash) {
    throw new Error('expectedHash does not match the current file contents')
  }
  const count = (content.match(new RegExp(input.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (count !== 1) throw new Error(`oldText must appear exactly once; found ${count}`)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tempPath, content.replace(input.oldText, input.newText), 'utf-8')
    assertNotAborted(context)
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
  return { success: true, linesChanged: input.newText.split('\n').length }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
