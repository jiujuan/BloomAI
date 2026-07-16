import { toolRepo } from '../db/repositories/tool.repo'
import { CapabilityError, executeLegacyToolCapability } from '../skills/policy/capability-broker'
import { ServiceError } from './errors'

type ToolServiceDependencies = {
  repo: typeof toolRepo
  executeLegacyToolCapability: typeof executeLegacyToolCapability
}

export function createToolService(overrides: Partial<ToolServiceDependencies> = {}) {
  const dependencies: ToolServiceDependencies = {
    repo: toolRepo,
    executeLegacyToolCapability,
    ...overrides,
  }

  return {
    list(input: { category?: string } = {}) {
      const tools = dependencies.repo.list(input.category)
      const permissions = Object.fromEntries(dependencies.repo.listPermissions().map((permission) => [permission.tool_id, permission]))
      return tools.map((tool) => ({ ...tool, permission: permissions[tool.id] ?? null }))
    },

    getStats() {
      return dependencies.repo.getStats()
    },

    listAllRuns(limit = 100) {
      return dependencies.repo.listAllRuns(limit)
    },

    listPermissions() {
      return dependencies.repo.listPermissions()
    },

    grantPermission(id: string, scope?: unknown) {
      const resolvedScope = typeof scope === 'string' && scope ? scope : 'session'
      dependencies.repo.grantPermission(id, resolvedScope)
      return { tool_id: id, granted: true, scope: resolvedScope }
    },

    revokePermission(id: string) {
      dependencies.repo.revokePermission(id)
      return { tool_id: id, granted: false }
    },

    get(id: string) {
      const tool = dependencies.repo.get(id)
      if (!tool) throw new ServiceError('NOT_FOUND', 'Tool not found')
      return { ...tool, permission: dependencies.repo.getPermission(id) ?? null }
    },

    setEnabled(id: string, enabled: unknown) {
      dependencies.repo.setEnabled(id, enabled === true)
      return dependencies.repo.get(id)
    },

    async run(id: string, input: { input?: unknown, sessionId?: unknown, approvalGranted?: unknown }) {
      try {
        const result = await dependencies.executeLegacyToolCapability({
          caller: 'http',
          toolId: id,
          input: isRecord(input.input) ? input.input : {},
          sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
          approvalGranted: input.approvalGranted === true,
        })
        return { output: result.output, toolRunId: result.toolRunId }
      } catch (error) {
        if (error instanceof CapabilityError) throw new ServiceError(error.code, error.message)
        throw new ServiceError('TOOL_ERROR', messageOf(error, 'Tool execution failed'))
      }
    },

    listRuns(id: string, limit = 50) {
      return dependencies.repo.listRuns(id, limit)
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const toolService = createToolService()