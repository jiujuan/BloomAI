import type { ToolExecutor } from './types'
import { workspaceSearchTool } from './workspace-search'

export const fsGlobTool: ToolExecutor<{ pattern: string; cwd?: string }> = async (input, context) => {
  const result = await workspaceSearchTool({
    mode: 'files',
    query: '',
    include: input.pattern,
    root: input.cwd,
    caseSensitive: true,
    maxResults: 100,
  }, context)
  return {
    files: result.results.map((file) => ({
      path: file.file,
      relativePath: file.relativePath,
      size: file.size,
      mtime: file.modifiedAt ? Date.parse(file.modifiedAt) : undefined,
    })),
    total: result.total,
    cwd: input.cwd,
  }
}
