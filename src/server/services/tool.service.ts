import { toolRepo } from '../db/repositories/tool.repo'
import { CapabilityError, executeLegacyToolCapability } from '../skills/policy/capability-broker'
import { sessionToolPermissionStore } from '../tools/session-permission-store'
import { getToolAvailability } from '../tools/availability'
import { getToolContract, schemaToJsonSchema } from '../tools/contracts'
import { ToolContractError } from '../tools/execute-tool'
import { getDataDir } from '../db/paths'
import { readScreenshotArtifact, type ScreenshotArtifactContent } from '../tools/web/screenshot-artifacts'
import { ServiceError } from './errors'
import { z } from 'zod'

type ToolServiceDependencies = {
  repo: typeof toolRepo
  executeLegacyToolCapability: typeof executeLegacyToolCapability
  getDataDir: typeof getDataDir
  readScreenshotArtifact: typeof readScreenshotArtifact
}

export function createToolService(overrides: Partial<ToolServiceDependencies> = {}) {
  const dependencies: ToolServiceDependencies = {
    repo: toolRepo,
    executeLegacyToolCapability,
    getDataDir,
    readScreenshotArtifact,
    ...overrides,
  }

  return {
    list(input: { category?: string } = {}) {
      const tools = dependencies.repo.list(input.category)
      const permissions = Object.fromEntries(dependencies.repo.listPermissions().map((permission) => [permission.tool_id, permission]))
      return tools.map((tool) => projectContract(tool, permissions[tool.id] ?? null))
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
      const parsed = z.literal('permanent').safeParse(scope ?? 'permanent')
      if (!parsed.success) throw new ServiceError('VALIDATION_ERROR', 'Only the permanent permission scope can be stored')
      dependencies.repo.grantPermission(id, parsed.data)
      return { tool_id: id, granted: true, scope: parsed.data }
    },

    grantSessionPermission(id: string, sessionId: string, ttlMs?: number) {
      if (!sessionId.trim()) throw new ServiceError('VALIDATION_ERROR', 'Session id is required for a session permission')
      sessionToolPermissionStore.grant(id, sessionId, ttlMs)
      return { tool_id: id, granted: true, scope: 'session', sessionId }
    },

    revokePermission(id: string) {
      dependencies.repo.revokePermission(id)
      return { tool_id: id, granted: false }
    },

    get(id: string) {
      const tool = dependencies.repo.get(id)
      if (!tool) throw new ServiceError('NOT_FOUND', 'Tool not found')
      return projectContract(tool, dependencies.repo.getPermission(id) ?? null)
    },

    setEnabled(id: string, enabled: unknown) {
      dependencies.repo.setEnabled(id, enabled === true)
      return dependencies.repo.get(id)
    },

    async run(id: string, input: Record<string, unknown>, signal?: AbortSignal) {
      try {
        if (Object.prototype.hasOwnProperty.call(input, 'approvalGranted')) {
          throw new ServiceError('VALIDATION_ERROR', 'approvalGranted is not accepted; use a trusted approval token')
        }
        const parsed = z.object({
          input: z.record(z.unknown()).default({}),
          sessionId: z.string().min(1).optional(),
          approvalToken: z.string().min(1).optional(),
        }).strict().parse(input)
        const result = await dependencies.executeLegacyToolCapability({
          caller: 'http',
          toolId: id,
          input: parsed.input,
          sessionId: parsed.sessionId,
          approvalToken: parsed.approvalToken,
          signal,
        })
        return { output: result.output, toolRunId: result.toolRunId }
      } catch (error) {
        if (error instanceof ServiceError) throw error
        if (error instanceof z.ZodError) throw new ServiceError('VALIDATION_ERROR', error.issues[0]?.message ?? 'Invalid tool request')
        if (error instanceof ToolContractError) throw new ServiceError('VALIDATION_ERROR', error.message)
        if (error instanceof CapabilityError) throw new ServiceError(error.code, error.message)
        throw new ServiceError('TOOL_ERROR', messageOf(error, 'Tool execution failed'))
      }
    },

    listRuns(id: string, limit = 50) {
      return dependencies.repo.listRuns(id, limit)
    },

    async getArtifact(id: string, runId: string, requestedRelativePath?: string): Promise<ScreenshotArtifactContent> {
      const tool = dependencies.repo.get(id)
      if (!tool) throw new ServiceError('NOT_FOUND', 'Tool not found')
      if (id !== 'web_screenshot') {
        throw new ServiceError('ARTIFACT_ERROR', 'Tool does not expose screenshot artifacts')
      }

      const run = dependencies.repo.getRun(id, runId)
      if (!run) throw new ServiceError('NOT_FOUND', 'Tool run not found')
      if (run.status !== 'success') {
        throw new ServiceError('ARTIFACT_ERROR', 'Tool run did not produce a screenshot artifact')
      }

      const metadata = readStoredScreenshotMetadata(run.output_json, runId)
      if (requestedRelativePath && requestedRelativePath !== metadata.relativePath) {
        throw new ServiceError('ARTIFACT_ERROR', 'Requested artifact does not match the recorded tool run')
      }

      try {
        const artifact = await dependencies.readScreenshotArtifact({
          dataDir: dependencies.getDataDir(),
          runId,
          relativePath: metadata.relativePath,
        })
        if (
          artifact.runId !== metadata.runId
          || artifact.relativePath !== metadata.relativePath
          || artifact.mimeType !== metadata.mimeType
        ) {
          throw new Error('Stored screenshot artifact metadata does not match the file')
        }
        return artifact
      } catch (error) {
        if (error instanceof ServiceError) throw error
        throw new ServiceError('ARTIFACT_ERROR', messageOf(error, 'Screenshot artifact could not be read'))
      }
    },
  }
}

function readStoredScreenshotMetadata(outputJson: string | null, runId: string): {
  runId: string
  relativePath: string
  mimeType: 'image/png' | 'image/jpeg'
} {
  let parsed: unknown
  try {
    parsed = outputJson ? JSON.parse(outputJson) : null
  } catch {
    throw new ServiceError('ARTIFACT_ERROR', 'Tool run output metadata is invalid')
  }

  const summary = isRecord(parsed) && isRecord(parsed.summary) ? parsed.summary : null
  const storedRunId = summary?.runId
  const relativePath = summary?.relativePath
  const mimeType = summary?.mimeType
  if (
    storedRunId !== runId
    || typeof relativePath !== 'string'
    || !new RegExp(`^tool-artifacts/web-screenshot/${escapeRegExp(runId)}/screenshot\\.(png|jpg)$`).test(relativePath)
    || (mimeType !== 'image/png' && mimeType !== 'image/jpeg')
  ) {
    throw new ServiceError('ARTIFACT_ERROR', 'Tool run does not contain valid screenshot artifact metadata')
  }

  return { runId, relativePath, mimeType }
}

function projectContract(tool: any, permission: unknown) {
  const contract = getToolContract(tool.id)
  if (!contract) return { ...tool, availability: getToolAvailability(tool.id), permission }
  return {
    ...tool,
    description: contract.description,
    params_schema: JSON.stringify(schemaToJsonSchema(contract.inputSchema)),
    result_schema: JSON.stringify(schemaToJsonSchema(contract.outputSchema)),
    requires_permission: contract.requiresPermission ?? tool.requires_permission,
    ...(contract.deprecated ? { deprecated: true } : {}),
    ...(contract.replacement ? { replacement: contract.replacement } : {}),
    availability: getToolAvailability(tool.id),
    permission,
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const toolService = createToolService()
