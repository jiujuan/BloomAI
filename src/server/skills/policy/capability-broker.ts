import { z } from 'zod'
import { toolRepo, type Tool, type ToolPermission, type ToolRun } from '../../db/repositories/tool.repo'
import { createSqliteSkillRuntimePorts } from '../../db/repositories/skill-package.repo'
import { executeToolInternal, ToolExecutionError, type ToolExecution, type ToolExecutionOptions } from '../../tools/execute-tool'
import { getToolAvailability } from '../../tools/availability'
import { approvalBroker, type ApprovalBroker } from '../../tools/approval-broker'
import { sessionToolPermissionStore, type SessionToolPermissionStore } from '../../tools/session-permission-store'
import { ImageStudioCapabilityAdapter, type ImageStudioBatchInput, type ImageStudioBatchResult } from '../adapters/image-studio-capability-adapter'
import { normalizeSkillRunEvent } from '../runtime/skill-run-events'
import type { CapabilityGrantRepository, CapabilityGrantSnapshot, RunSnapshot, SkillRunEventRepository, SkillRunRepository } from '../application/ports'
import { isScopeAllowed, skillCapabilitySchema, type CapabilityScope, type SkillCapability } from './capability-policy'

const DEFAULT_TIMEOUT_MS = 15_000
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  web_fetch: 60_000,
  web_extract: 60_000,
  web_screenshot: 60_000,
}

const PACKAGE_CAPABILITY_TO_TOOL: Record<string, string> = {
  'web.search': 'web_search',
  'web.fetch': 'web_fetch',
  'document.read_uploaded': 'doc_markdown',
  'image.generate': 'image_gen',
}

const FORBIDDEN_PACKAGE_CAPABILITIES = new Set([
  'shell.execute',
  'python.execute',
  'dependency.install',
  'workspace.write',
  'home.read',
])

const GATED_TOOL_PERMISSION_LEVELS = new Set(['write', 'shell', 'sandbox'])
const capabilityScopeSchema = z.object({
  allowedRoots: z.array(z.string().min(1)).min(1).optional(),
  allowedDomains: z.array(z.string().min(1)).min(1).optional(),
  allowedModels: z.array(z.string().min(1)).min(1).optional(),
  maxCalls: z.number().int().positive().optional(),
}).strict()

const capabilityRequestSchema = z.object({
  caller: z.enum(['chat', 'workflow', 'http', 'package-runtime']),
  capability: z.string().min(1),
  input: z.record(z.unknown()),
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  grantContext: z.record(z.unknown()).optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
})

export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>

export type CapabilityResult = {
  capability: string
  toolId: string
  toolRunId: string
  output: object
}

export type CapabilityToolRepository = {
  get(id: string): Tool | undefined
  startRun(toolId: string, sessionId: string | null, input: unknown): ToolRun
  completeRun(id: string, output: unknown): void
  failRun(id: string, error: string, status?: string): void
  getPermission(toolId: string): ToolPermission | undefined
}

export type CapabilityImageAdapter = {
  run(input: ImageStudioBatchInput): Promise<ImageStudioBatchResult>
}

export type CapabilityBrokerDependencies = {
  readonly runs: SkillRunRepository
  readonly grants: CapabilityGrantRepository
  readonly events: SkillRunEventRepository
  readonly tools: CapabilityToolRepository
  readonly executeTool: (
    toolId: string,
    rawInput: unknown,
    sessionId: string | undefined,
    timeoutMs: number,
    options?: ToolExecutionOptions,
  ) => Promise<ToolExecution>
  readonly getToolAvailability: typeof getToolAvailability
  readonly approvals: Pick<ApprovalBroker, 'consume'>
  readonly permissions: Pick<SessionToolPermissionStore, 'has'>
  readonly imageAdapterFactory: () => CapabilityImageAdapter
}

export class CapabilityError extends Error {
  constructor(
    readonly code: 'CAPABILITY_DENIED' | 'CAPABILITY_APPROVAL_REQUIRED' | 'CAPABILITY_DISABLED' | 'CAPABILITY_NOT_SUPPORTED',
    message: string,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class CapabilityDeniedError extends CapabilityError {
  constructor(message: string) {
    super('CAPABILITY_DENIED', message)
  }
}

export class CapabilityApprovalRequiredError extends CapabilityError {
  constructor(message: string) {
    super('CAPABILITY_APPROVAL_REQUIRED', message)
  }
}

export class CapabilityDisabledError extends CapabilityError {
  constructor(message: string) {
    super('CAPABILITY_DISABLED', message)
  }
}

export class CapabilityNotSupportedError extends CapabilityError {
  constructor(message: string) {
    super('CAPABILITY_NOT_SUPPORTED', message)
  }
}

export function needsInteractiveApprovalForTool(tool: Pick<Tool, 'requires_permission'>): boolean {
  return !!tool.requires_permission && GATED_TOOL_PERMISSION_LEVELS.has(tool.requires_permission)
}

export class CapabilityBroker {
  constructor(private readonly dependencies: CapabilityBrokerDependencies = createDefaultCapabilityBrokerDependencies()) {}

  async executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
    const parsed = capabilityRequestSchema.parse(request)
    const toolId = this.resolveToolId(parsed)
    const tool = this.requireEnabledTool(toolId)
    let packageScope: CapabilityScope | undefined

    if (parsed.caller === 'package-runtime') {
      const grant = this.requirePackageGrant(parsed)
      this.enforcePackageScope(parsed, grant.scope)
      packageScope = grant.scope
      if (grant.grantMode === 'once' && !this.dependencies.grants.consumeCapabilityGrant(grant.id)) {
        throw new CapabilityApprovalRequiredError(`Capability approval has already been used: ${parsed.capability}`)
      }
    } else {
      this.requireLegacyToolPermission(tool, parsed.grantContext, parsed.sessionId, parsed.input)
    }

    if (parsed.caller === 'package-runtime' && parsed.capability === 'image.generate') {
      return this.executePackageImageCapability(parsed, toolId)
    }

    try {
      const execution = await this.dependencies.executeTool(
        toolId,
        parsed.input,
        parsed.sessionId,
        TOOL_TIMEOUT_OVERRIDES[toolId] ?? DEFAULT_TIMEOUT_MS,
        {
          caller: parsed.caller,
          signal: parsed.signal,
          allowedRoots: packageScope?.allowedRoots,
        },
      )
      this.auditPackageCall(parsed, toolId, execution.toolRunId, 'completed')
      return { capability: parsed.capability, toolId, toolRunId: execution.toolRunId, output: execution.output }
    } catch (error) {
      if (error instanceof ToolExecutionError) this.auditPackageCall(parsed, toolId, error.toolRunId, 'failed', error.message)
      throw error
    }
  }

  async executeLegacyToolCapability(data: {
    caller: Exclude<CapabilityRequest['caller'], 'package-runtime'>
    toolId: string
    input: Record<string, unknown>
    sessionId?: string
    approvalToken?: string
    signal?: AbortSignal
  }): Promise<CapabilityResult> {
    return this.executeCapability({
      caller: data.caller,
      capability: `tool.${data.toolId}`,
      input: data.input,
      sessionId: data.sessionId,
      grantContext: data.approvalToken ? { approvalToken: data.approvalToken } : undefined,
      signal: data.signal,
    })
  }

  private resolveToolId(request: CapabilityRequest): string {
    if (request.caller !== 'package-runtime') return request.capability.slice('tool.'.length)
    if (FORBIDDEN_PACKAGE_CAPABILITIES.has(request.capability)) {
      throw new CapabilityDeniedError(`Capability is not supported by the B-Lite package runtime: ${request.capability}`)
    }
    const toolId = PACKAGE_CAPABILITY_TO_TOOL[request.capability]
    if (!toolId) throw new CapabilityNotSupportedError(`Capability is not available yet: ${request.capability}`)
    return toolId
  }

  private requireEnabledTool(toolId: string): Tool {
    const tool = this.dependencies.tools.get(toolId)
    if (!tool) throw new CapabilityNotSupportedError(`Tool not found: ${toolId}`)
    if (tool.is_enabled !== 1) throw new CapabilityDisabledError(`Tool ${toolId} is disabled`)
    const availability = this.dependencies.getToolAvailability(toolId)
    if (availability.status !== 'available') {
      throw new CapabilityNotSupportedError(`${toolId} is unavailable: ${availability.reason}`)
    }
    return tool
  }

  private requireLegacyToolPermission(
    tool: Tool,
    grantContext: Record<string, unknown> | undefined,
    sessionId: string | undefined,
    input: Record<string, unknown>,
  ): void {
    if (!needsInteractiveApprovalForTool(tool)) return
    if (tool.id === 'fs_apply_patch' && input.dryRun !== false) return

    if (this.dependencies.permissions.has(tool.id, sessionId)) return

    const permanentPermission = this.dependencies.tools.getPermission(tool.id)
    if (permanentPermission?.granted === 1 && permanentPermission.scope === 'permanent') return

    const approvalToken = typeof grantContext?.approvalToken === 'string' ? grantContext.approvalToken : undefined
    if (approvalToken && sessionId) {
      try {
        this.dependencies.approvals.consume(approvalToken, { toolId: tool.id, sessionId, input })
        return
      } catch {
        // Invalid, expired, or already-consumed tokens fall through to the stable approval error.
      }
    }

    throw new CapabilityApprovalRequiredError(
      `Permission required: "${tool.id}" needs "${tool.requires_permission}" access. Grant it in Tools settings or approve this exact call before retrying.`,
    )
  }

  private requirePackageGrant(request: CapabilityRequest): CapabilityGrantSnapshot & { scope: CapabilityScope } {
    if (!request.runId) throw new CapabilityDeniedError('Package capability calls require a runId')
    const run = this.dependencies.runs.getRun(request.runId)
    if (!run) throw new CapabilityDeniedError(`Skill run not found: ${request.runId}`)

    const capability = skillCapabilitySchema.safeParse(request.capability)
    if (!capability.success) throw new CapabilityNotSupportedError(`Capability is not available yet: ${request.capability}`)
    const grant = this.dependencies.grants.findActiveCapabilityGrant({
      skillVersionId: run.skillVersionId,
      capability: capability.data,
      sessionId: request.sessionId,
      runId: request.runId,
    })
    if (!grant) throw new CapabilityApprovalRequiredError(`Capability approval required: ${request.capability}`)

    const parsedScope = capabilityScopeSchema.safeParse(grant.scope)
    if (!parsedScope.success) throw new CapabilityDeniedError(`Invalid capability grant scope for: ${request.capability}`)
    return { ...grant, scope: parsedScope.data }
  }

  private enforcePackageScope(request: CapabilityRequest, scope: CapabilityScope): void {
    const capability = skillCapabilitySchema.parse(request.capability) as SkillCapability
    const allowed = isScopeAllowed({ capability, input: request.input, scope })
    if (!allowed.allowed) throw new CapabilityDeniedError(allowed.reason)
    if (capability !== 'image.generate' || !scope.maxCalls || !request.runId) return

    const calls = this.dependencies.events.listEvents(request.runId).filter((event) => {
      return event.type === 'capability.call' && event.payload.capability === 'image.generate'
    }).length
    if (calls >= scope.maxCalls) throw new CapabilityDeniedError(`Image generation budget exhausted (${scope.maxCalls} calls)`)
  }

  private async executePackageImageCapability(request: CapabilityRequest, toolId: string): Promise<CapabilityResult> {
    if (!request.runId) throw new CapabilityDeniedError('Package capability calls require a runId')
    const input = imageGenerationInputSchema.parse(request.input)
    const toolRun = this.dependencies.tools.startRun(toolId, request.sessionId ?? null, input)
    try {
      const batch = await this.dependencies.imageAdapterFactory().run({
        runId: request.runId,
        imageSessionId: input.imageSessionId,
        title: input.title,
        items: [{
          id: toolRun.id,
          prompt: input.prompt,
          model: input.model,
          aspectRatioId: input.aspectRatioId,
          styleId: input.styleId,
          referenceImages: input.referenceImages,
          negativePrompt: input.negativePrompt,
          seed: input.seed,
          optimize: input.optimize,
        }],
      })
      const output = { imageSessionId: batch.imageSessionId, status: batch.status, item: batch.items[0] }
      this.dependencies.tools.completeRun(toolRun.id, output)
      this.auditPackageCall(request, toolId, toolRun.id, 'completed')
      return { capability: request.capability, toolId, toolRunId: toolRun.id, output }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed'
      this.dependencies.tools.failRun(toolRun.id, message)
      this.auditPackageCall(request, toolId, toolRun.id, 'failed', message)
      throw error
    }
  }

  private auditPackageCall(
    request: CapabilityRequest,
    toolId: string,
    toolRunId: string,
    status: 'completed' | 'failed',
    error?: string,
  ): void {
    if (request.caller !== 'package-runtime' || !request.runId) return
    this.dependencies.events.appendEvent({
      runId: request.runId,
      seq: this.dependencies.events.nextSequence(request.runId),
      ...normalizeSkillRunEvent({
        type: 'capability.call',
        payload: {
          runId: request.runId,
          toolRunId,
          capability: request.capability,
          toolId,
          status,
          ...(error ? { error } : {}),
        },
      }),
    })
  }
}

export const defaultCapabilityBroker = new CapabilityBroker()

export async function executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
  return defaultCapabilityBroker.executeCapability(request)
}

export async function executeLegacyToolCapability(data: {
  caller: Exclude<CapabilityRequest['caller'], 'package-runtime'>
  toolId: string
  input: Record<string, unknown>
  sessionId?: string
  approvalToken?: string
  signal?: AbortSignal
}): Promise<CapabilityResult> {
  return defaultCapabilityBroker.executeLegacyToolCapability(data)
}

function createDefaultCapabilityBrokerDependencies(): CapabilityBrokerDependencies {
  const ports = createSqliteSkillRuntimePorts()
  return {
    runs: ports.runs,
    grants: ports.grants,
    events: ports.events,
    tools: toolRepo,
    executeTool: executeToolInternal,
    getToolAvailability,
    approvals: approvalBroker,
    permissions: sessionToolPermissionStore,
    imageAdapterFactory: () => new ImageStudioCapabilityAdapter(),
  }
}

const imageGenerationInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1),
  imageSessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  aspectRatioId: z.string().min(1).optional(),
  styleId: z.string().min(1).nullable().optional(),
  referenceImages: z.array(z.string().min(1)).optional(),
  negativePrompt: z.string().min(1).optional(),
  seed: z.number().int().optional(),
  optimize: z.boolean().optional(),
}).strict()
