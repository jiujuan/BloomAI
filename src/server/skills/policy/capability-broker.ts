import { z } from 'zod'
import { toolRepo, type Tool, type ToolPermission, type ToolRun } from '../../db/repositories/tool.repo'
import { createSqliteSkillRuntimePorts } from '../../db/repositories/skill-package.repo'
import { executeToolInternal, ToolExecutionError, type ToolExecution, type ToolExecutionOptions } from '../../tools/execute-tool'
import { getToolAvailability } from '../../tools/availability'
import { approvalBroker, type ApprovalBroker } from '../../tools/approval-broker'
import { sessionToolPermissionStore, type SessionToolPermissionStore } from '../../tools/session-permission-store'
import { ImageStudioCapabilityAdapter, type ImageStudioBatchInput, type ImageStudioBatchResult } from '../adapters/image-studio-capability-adapter'
import { normalizeSkillRunEvent } from '../runtime/skill-run-events'
import { SkillRuntimeMetrics, type SkillRuntimeCorrelation } from '../observability/skill-runtime.metrics'
import { withSkillCorrelation } from '../observability/skill-runtime.logger'
import type { ArtifactRepository, CapabilityGrantRepository, CapabilityGrantSnapshot, RunSnapshot, SkillRunEventRepository, SkillRunRepository } from '../application/ports'
import { isScopeAllowed, skillCapabilitySchema, type CapabilityScope, type SkillCapability } from './capability-policy'
import { assertCapabilityAllowed } from '../security/skill-security-checklist'

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
  idempotencyKey: z.string().min(1).max(256).optional(),
  requestedTimeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
})

export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>

export type CapabilityResult = {
  capability: string
  toolId: string
  toolRunId: string
  status: 'completed'
  output: object
  artifactIds: string[]
  usage: { calls: number; timeoutMs?: number }
  errorCode: string | null
  retryable: boolean
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
  readonly artifacts?: Pick<ArtifactRepository, 'listArtifacts'>
  readonly metrics?: Pick<SkillRuntimeMetrics, 'recordCapability'>
  readonly now?: () => number
}

export type CapabilityErrorDetails = {
  capability?: string
  grantId?: string
  requestedScope?: Record<string, unknown>
  expiresAt?: number | null
  reasonCode?: string
}

export class CapabilityError extends Error {
  constructor(
    readonly code: 'CAPABILITY_DENIED' | 'CAPABILITY_APPROVAL_REQUIRED' | 'CAPABILITY_DISABLED' | 'CAPABILITY_NOT_SUPPORTED',
    message: string,
    readonly details?: CapabilityErrorDetails,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class CapabilityDeniedError extends CapabilityError {
  constructor(message: string, details?: CapabilityErrorDetails) {
    super('CAPABILITY_DENIED', message, details)
  }
}

export class CapabilityApprovalRequiredError extends CapabilityError {
  constructor(message: string, details?: CapabilityErrorDetails) {
    super('CAPABILITY_APPROVAL_REQUIRED', message, details)
  }
}

export class CapabilityDisabledError extends CapabilityError {
  constructor(message: string, details?: CapabilityErrorDetails) {
    super('CAPABILITY_DISABLED', message, details)
  }
}

export class CapabilityNotSupportedError extends CapabilityError {
  constructor(message: string, details?: CapabilityErrorDetails) {
    super('CAPABILITY_NOT_SUPPORTED', message, details)
  }
}

export function needsInteractiveApprovalForTool(tool: Pick<Tool, 'requires_permission'>): boolean {
  return !!tool.requires_permission && GATED_TOOL_PERMISSION_LEVELS.has(tool.requires_permission)
}

type CapabilityMetricContext = { correlation: SkillRuntimeCorrelation }

export class CapabilityBroker {
  private readonly idempotentResults = new Map<string, CapabilityResult>()
  private readonly now: () => number

  constructor(private readonly dependencies: CapabilityBrokerDependencies = createDefaultCapabilityBrokerDependencies()) {
    this.now = dependencies.now ?? (() => Date.now())
  }

  async executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
    const parsed = capabilityRequestSchema.parse(request)
    const context: CapabilityMetricContext = { correlation: this.resolveCorrelation(parsed) }
    const startedAt = this.now()
    return withSkillCorrelation(context.correlation, async () => {
      try {
        const result = await this.executeCapabilityInternal(parsed, context)
        this.recordCapabilityMetric(parsed, startedAt, 'success', null, context.correlation)
        return result
      } catch (error) {
        this.recordCapabilityMetric(parsed, startedAt, 'error', this.toMetricErrorCode(error), context.correlation)
        throw error
      }
    })
  }

  private async executeCapabilityInternal(parsed: CapabilityRequest, context: CapabilityMetricContext): Promise<CapabilityResult> {
    if (parsed.caller === 'package-runtime' && !parsed.runId) {
      throw new CapabilityDeniedError('Package capability calls require a runId')
    }
    const cached = this.getIdempotentResult(parsed)
    if (cached) return cached

    if (parsed.caller === 'package-runtime') {
      this.appendCapabilityEvent(parsed, 'capability.requested', {
        capability: parsed.capability,
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      })
    }

    const toolId = this.resolveToolId(parsed)
    const tool = this.requireEnabledTool(toolId)
    let packageScope: CapabilityScope | undefined
    let grant: (CapabilityGrantSnapshot & { scope: CapabilityScope }) | undefined

    if (parsed.caller === 'package-runtime') {
      grant = this.requirePackageGrant(parsed, this.now())
      context.correlation = {
        ...context.correlation,
        skillVersionId: grant.skillVersionId,
        grantId: grant.id,
      }
      this.enforcePackageScope(parsed, grant.scope)
      packageScope = grant.scope
      if (!this.dependencies.grants.consumeCapabilityGrant(grant.id, this.now(), {
        runId: parsed.runId,
        sessionId: parsed.sessionId,
      })) {
        if (grant.maxCalls !== null && grant.callsUsed >= grant.maxCalls) {
          throw new CapabilityDeniedError(`Capability budget exhausted (${grant.maxCalls} calls): ${parsed.capability}`, {
            capability: parsed.capability,
            grantId: grant.id,
            expiresAt: grant.expiresAt,
            reasonCode: 'CAPABILITY_BUDGET_EXHAUSTED',
          })
        }
        throw new CapabilityApprovalRequiredError(`Capability approval has already been used or is no longer active: ${parsed.capability}`)
      }
      this.appendCapabilityEvent(parsed, 'capability.started', {
        capability: parsed.capability,
        toolId,
        grantId: grant.id,
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      })
    } else {
      this.requireLegacyToolPermission(tool, parsed.grantContext, parsed.sessionId, parsed.input)
    }

    if (parsed.caller === 'package-runtime' && parsed.capability === 'image.generate') {
      return withSkillCorrelation(context.correlation, () => this.executePackageImageCapability(parsed, toolId, grant!))
    }

    const timeoutMs = Math.min(parsed.requestedTimeoutMs ?? (TOOL_TIMEOUT_OVERRIDES[toolId] ?? DEFAULT_TIMEOUT_MS), TOOL_TIMEOUT_OVERRIDES[toolId] ?? DEFAULT_TIMEOUT_MS)
    try {
      const execution = await withSkillCorrelation(context.correlation, () => this.dependencies.executeTool(
        toolId,
        parsed.input,
        parsed.sessionId,
        timeoutMs,
        {
          caller: parsed.caller,
          signal: parsed.signal,
          allowedRoots: packageScope?.allowedRoots,
        },
      ))
      const result = this.normalizeResult(parsed, toolId, execution.toolRunId, execution.output, timeoutMs)
      this.appendCapabilityEvent(parsed, 'capability.completed', {
        capability: parsed.capability,
        toolId,
        toolRunId: execution.toolRunId,
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      })
      this.auditPackageCall(parsed, toolId, execution.toolRunId, 'completed')
      this.rememberIdempotentResult(parsed, result)
      return result
    } catch (error) {
      const toolRunId = error instanceof ToolExecutionError ? error.toolRunId : undefined
      const errorCode = error instanceof ToolExecutionError ? `TOOL_${error.status.toUpperCase()}` : 'CAPABILITY_EXECUTION_FAILED'
      this.appendCapabilityEvent(parsed, 'capability.failed', {
        capability: parsed.capability,
        toolId,
        ...(toolRunId ? { toolRunId } : {}),
        errorCode,
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      })
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
    idempotencyKey?: string
    requestedTimeoutMs?: number
  }): Promise<CapabilityResult> {
    return this.executeCapability({
      caller: data.caller,
      capability: `tool.${data.toolId}`,
      input: data.input,
      sessionId: data.sessionId,
      grantContext: data.approvalToken ? { approvalToken: data.approvalToken } : undefined,
      idempotencyKey: data.idempotencyKey,
      requestedTimeoutMs: data.requestedTimeoutMs,
      signal: data.signal,
    })
  }

  private resolveCorrelation(request: CapabilityRequest): SkillRuntimeCorrelation {
    const correlation: SkillRuntimeCorrelation = request.runId ? { runId: request.runId } : {}
    if (!request.runId) return correlation
    try {
      const run = this.dependencies.runs.getRun(request.runId)
      if (run) correlation.skillVersionId = run.skillVersionId
    } catch { /* diagnostics must not block capability validation */ }
    return correlation
  }

  private recordCapabilityMetric(
    request: CapabilityRequest,
    startedAt: number,
    outcome: 'success' | 'error',
    errorCode: string | null,
    correlation: SkillRuntimeCorrelation,
  ): void {
    try {
      this.dependencies.metrics?.recordCapability({
        capability: request.capability,
        durationMs: Math.max(0, this.now() - startedAt),
        outcome,
        errorCode,
        correlation: { ...correlation },
      })
    } catch { /* telemetry must never block a capability call */ }
  }

  private toMetricErrorCode(error: unknown): string {
    if (error instanceof CapabilityError) {
      if (error.details?.reasonCode === 'CAPABILITY_BUDGET_EXHAUSTED') return 'BUDGET_EXHAUSTED'
      switch (error.code) {
        case 'CAPABILITY_APPROVAL_REQUIRED': return 'APPROVAL_REQUIRED'
        case 'CAPABILITY_DISABLED': return 'DISABLED'
        case 'CAPABILITY_NOT_SUPPORTED': return 'NOT_SUPPORTED'
        case 'CAPABILITY_DENIED': return 'DENIED'
      }
    }
    if (error instanceof ToolExecutionError) {
      const status = error.status.toUpperCase()
      if (status === 'TIMEOUT') return 'TIMEOUT'
      if (status === 'ABORTED' || status === 'CANCELLED') return 'ABORTED'
      return 'EXECUTION_ERROR'
    }
    return 'UNKNOWN_ERROR'
  }

  private resolveToolId(request: CapabilityRequest): string {
    if (request.caller !== 'package-runtime') return request.capability.slice('tool.'.length)

    let capability: string
    try {
      capability = assertCapabilityAllowed(request.capability)
    } catch (error) {
      throw new CapabilityDeniedError(
        error instanceof Error
          ? error.message
          : `Capability is not supported by the B-Lite package runtime: ${request.capability}`,
        { capability: request.capability },
      )
    }

    const toolId = PACKAGE_CAPABILITY_TO_TOOL[capability]
    if (!toolId) throw new CapabilityNotSupportedError(`Capability is not available yet: ${capability}`, { capability })
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

  private requirePackageGrant(request: CapabilityRequest, now = this.now()): CapabilityGrantSnapshot & { scope: CapabilityScope } {
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
      now,
    })
    if (!grant) {
      // Active-grant lookup intentionally filters exhausted grants. Inspect all grants
      // here so an exhausted global/run/session grant is reported as a deterministic
      // budget denial instead of being misclassified as a new approval request.
      const exhausted = this.dependencies.grants.listCapabilityGrants(run.skillVersionId)
        .find((candidate) => candidate.capability === capability.data
          && (candidate.status === 'approved' || candidate.status === 'consumed')
          && (candidate.runId === null || candidate.runId === request.runId)
          && (candidate.sessionId === null || request.sessionId !== undefined && candidate.sessionId === request.sessionId)
          && candidate.maxCalls !== null
          && candidate.callsUsed >= candidate.maxCalls)
      if (exhausted) {
        throw new CapabilityDeniedError(`Capability budget exhausted (${exhausted.maxCalls} calls): ${request.capability}`, {
          capability: request.capability,
          grantId: exhausted.id,
          expiresAt: exhausted.expiresAt,
          reasonCode: 'CAPABILITY_BUDGET_EXHAUSTED',
        })
      }
      const pending = this.dependencies.grants.listCapabilityGrants(run.skillVersionId)
        .filter((candidate) => candidate.capability === capability.data
          && candidate.status === 'pending'
          && (candidate.runId === null || candidate.runId === request.runId)
          && (candidate.sessionId === null || candidate.sessionId === request.sessionId))
        .at(-1)
      if (pending) {
        throw new CapabilityApprovalRequiredError(`Capability approval required: ${request.capability}`, {
          capability: request.capability,
          grantId: pending.id,
          requestedScope: pending.requestedScope,
          expiresAt: pending.expiresAt,
        })
      }
      throw new CapabilityApprovalRequiredError(`Capability approval required: ${request.capability}`, {
        capability: request.capability,
      })
    }

    const parsedScope = capabilityScopeSchema.safeParse(grant.scope)
    if (!parsedScope.success) throw new CapabilityDeniedError(`Invalid capability grant scope for: ${request.capability}`)
    return { ...grant, scope: parsedScope.data }
  }

  private enforcePackageScope(request: CapabilityRequest, scope: CapabilityScope): void {
    const capability = skillCapabilitySchema.parse(request.capability) as SkillCapability
    const allowed = isScopeAllowed({ capability, input: request.input, scope })
    if (!allowed.allowed) throw new CapabilityDeniedError(allowed.reason, {
      capability: request.capability,
    })
  }

  private async executePackageImageCapability(request: CapabilityRequest, toolId: string, grant: CapabilityGrantSnapshot): Promise<CapabilityResult> {
    if (!request.runId) throw new CapabilityDeniedError('Package capability calls require a runId')
    const input = imageGenerationInputSchema.parse(request.input)
    const toolRun = this.dependencies.tools.startRun(toolId, request.sessionId ?? null, input)
    try {
      const batch = await this.dependencies.imageAdapterFactory().run({
        runId: request.runId,
        skillVersionId: grant.skillVersionId,
        grantId: grant.id,
        imageSessionId: input.imageSessionId,
        title: input.title,
        items: [{
          id: toolRun.id,
          prompt: input.prompt,
          model: input.model,
          size: input.size,
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
      const result = this.normalizeResult(request, toolId, toolRun.id, output, undefined)
      this.appendCapabilityEvent(request, 'capability.completed', {
        capability: request.capability,
        toolId,
        toolRunId: toolRun.id,
        artifactIds: this.listArtifactIds(request.runId),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      })
      this.auditPackageCall(request, toolId, toolRun.id, 'completed')
      this.rememberIdempotentResult(request, result)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed'
      this.dependencies.tools.failRun(toolRun.id, message)
      this.appendCapabilityEvent(request, 'capability.failed', {
        capability: request.capability,
        toolId,
        toolRunId: toolRun.id,
        errorCode: 'IMAGE_GENERATION_FAILED',
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      })
      this.auditPackageCall(request, toolId, toolRun.id, 'failed', message)
      throw error
    }
  }

  private normalizeResult(request: CapabilityRequest, toolId: string, toolRunId: string, output: object, timeoutMs?: number): CapabilityResult {
    return {
      capability: request.capability,
      toolId,
      toolRunId,
      status: 'completed',
      output,
      artifactIds: request.runId ? this.listArtifactIds(request.runId) : [],
      usage: { calls: 1, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
      errorCode: null,
      retryable: false,
    }
  }

  private listArtifactIds(runId: string): string[] {
    return this.dependencies.artifacts?.listArtifacts(runId).map((artifact) => artifact.id) ?? []
  }

  private getIdempotentResult(request: CapabilityRequest): CapabilityResult | undefined {
    if (request.caller !== 'package-runtime' || !request.runId || !request.idempotencyKey) return undefined
    return this.idempotentResults.get(`${request.runId}: ${request.idempotencyKey}`)
  }

  private rememberIdempotentResult(request: CapabilityRequest, result: CapabilityResult): void {
    if (request.caller !== 'package-runtime' || !request.runId || !request.idempotencyKey) return
    this.idempotentResults.set(`${request.runId}: ${request.idempotencyKey}`, result)
  }

  private appendCapabilityEvent(request: CapabilityRequest, type: 'capability.requested' | 'capability.started' | 'capability.completed' | 'capability.failed', payload: Record<string, unknown>): void {
    if (request.caller !== 'package-runtime' || !request.runId) return
    this.dependencies.events.appendEvent({
      runId: request.runId,
      seq: this.dependencies.events.nextSequence(request.runId),
      ...normalizeSkillRunEvent({ type, payload }),
    })
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
    artifacts: ports.artifacts,
    metrics: SkillRuntimeMetrics.global(),
  }
}

const imageGenerationInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1),
  size: z.string().min(1).max(64).optional(),
  imageSessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  aspectRatioId: z.string().min(1).optional(),
  styleId: z.string().min(1).nullable().optional(),
  referenceImages: z.array(z.string().min(1)).optional(),
  negativePrompt: z.string().min(1).optional(),
  seed: z.number().int().optional(),
  optimize: z.boolean().optional(),
}).strict()
