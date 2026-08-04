import * as fs from 'fs'
import * as path from 'path'
import type { ToolExecutor } from './types'
import { workspaceSearchTool } from './workspace-search'
import { resolveToolPath } from './utils/tool-resource'

export const fsGrepTool: ToolExecutor<{ pattern: string; path: string; recursive?: boolean }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const stat = await fs.promises.lstat(filePath)
  const root = stat.isDirectory() ? filePath : path.dirname(filePath)
  const include = stat.isDirectory()
    ? (input.recursive ? '**/*' : '*')
    : path.basename(filePath)
  const result = await workspaceSearchTool({
    mode: 'text',
    query: input.pattern,
    root,
    include,
    caseSensitive: true,
    maxResults: 100,
  }, context)
  return {
    matches: result.results.map((match) => ({
      file: match.file,
      line: match.line,
      text: match.preview?.trim(),
    })),
    total: result.total,
  }
}
