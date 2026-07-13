import { z } from 'zod'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { toolRepo, type Tool } from '../../db/repositories/tool.repo'
import { executeToolInternal, ToolExecutionError } from '../../tools/execute-tool'
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

const capabilityRequestSchema = z.object({
  caller: z.enum(['chat', 'workflow', 'http', 'package-runtime']),
  capability: z.string().min(1),
  input: z.record(z.unknown()),
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  grantContext: z.record(z.unknown()).optional(),
})

export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>

export type CapabilityResult = {
  capability: string
  toolId: string
  toolRunId: string
  output: object
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

export async function executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
  const parsed = capabilityRequestSchema.parse(request)
  const toolId = resolveToolId(parsed)
  const tool = requireEnabledTool(toolId)

  if (parsed.caller === 'package-runtime') {
    const grant = requirePackageGrant(parsed)
    enforcePackageScope(parsed, grant.scope)
    if (grant.grantMode === 'once' && !skillPackageRepo.consumeCapabilityGrant(grant.id)) {
      throw new CapabilityApprovalRequiredError(`Capability approval has already been used: ${parsed.capability}`)
    }
  } else {
    requireLegacyToolPermission(tool, parsed.grantContext)
  }

  try {
    const execution = await executeToolInternal(
      toolId,
      parsed.input,
      parsed.sessionId,
      TOOL_TIMEOUT_OVERRIDES[toolId] ?? DEFAULT_TIMEOUT_MS,
    )
    auditPackageCall(parsed, toolId, execution.toolRunId, 'completed')
    return { capability: parsed.capability, toolId, toolRunId: execution.toolRunId, output: execution.output }
  } catch (error) {
    if (error instanceof ToolExecutionError) auditPackageCall(parsed, toolId, error.toolRunId, 'failed', error.message)
    throw error
  }
}

export async function executeLegacyToolCapability(data: {
  caller: Exclude<CapabilityRequest['caller'], 'package-runtime'>
  toolId: string
  input: Record<string, unknown>
  sessionId?: string
  approvalGranted?: boolean
}): Promise<CapabilityResult> {
  return executeCapability({
    caller: data.caller,
    capability: `tool.${data.toolId}`,
    input: data.input,
    sessionId: data.sessionId,
    grantContext: data.approvalGranted ? { interactiveApprovalGranted: true } : undefined,
  })
}

function resolveToolId(request: CapabilityRequest): string {
  if (request.caller !== 'package-runtime') return request.capability.slice('tool.'.length)
  if (FORBIDDEN_PACKAGE_CAPABILITIES.has(request.capability)) {
    throw new CapabilityDeniedError(`Capability is not supported by the B-Lite package runtime: ${request.capability}`)
  }
  const toolId = PACKAGE_CAPABILITY_TO_TOOL[request.capability]
  if (!toolId) throw new CapabilityNotSupportedError(`Capability is not available yet: ${request.capability}`)
  return toolId
}

function requireEnabledTool(toolId: string): Tool {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new CapabilityNotSupportedError(`Tool not found: ${toolId}`)
  if (tool.is_enabled !== 1) throw new CapabilityDisabledError(`Tool ${toolId} is disabled`)
  return tool
}

function requireLegacyToolPermission(tool: Tool, grantContext: Record<string, unknown> | undefined): void {
  if (!needsInteractiveApprovalForTool(tool)) return
  if (grantContext?.interactiveApprovalGranted === true) return
  if (toolRepo.getPermission(tool.id)?.granted === 1) return
  throw new CapabilityApprovalRequiredError(
    `Permission required: "${tool.id}" needs "${tool.requires_permission}" access. Grant it in Tools settings before retrying.`,
  )
}

function requirePackageGrant(request: CapabilityRequest): { id: string; grantMode: string; scope: CapabilityScope } {
  if (!request.runId) throw new CapabilityDeniedError('Package capability calls require a runId')
  const run = skillPackageRepo.getRun(request.runId)
  if (!run) throw new CapabilityDeniedError(`Skill run not found: ${request.runId}`)

  const capability = skillCapabilitySchema.safeParse(request.capability)
  if (!capability.success) throw new CapabilityNotSupportedError(`Capability is not available yet: ${request.capability}`)
  const grant = skillPackageRepo.findActiveCapabilityGrant({
    skillVersionId: run.skill_version_id,
    capability: capability.data,
    sessionId: request.sessionId,
  })
  if (!grant) throw new CapabilityApprovalRequiredError(`Capability approval required: ${request.capability}`)

  try {
    const scope = z.object({
      allowedRoots: z.array(z.string().min(1)).min(1).optional(),
      allowedDomains: z.array(z.string().min(1)).min(1).optional(),
      allowedModels: z.array(z.string().min(1)).min(1).optional(),
      maxCalls: z.number().int().positive().optional(),
    }).strict().parse(JSON.parse(grant.scope_json))
    return { id: grant.id, grantMode: grant.grant_mode, scope }
  } catch {
    throw new CapabilityDeniedError(`Invalid capability grant scope for: ${request.capability}`)
  }
}

function enforcePackageScope(request: CapabilityRequest, scope: CapabilityScope): void {
  const capability = skillCapabilitySchema.parse(request.capability) as SkillCapability
  const allowed = isScopeAllowed({ capability, input: request.input, scope })
  if (!allowed.allowed) throw new CapabilityDeniedError(allowed.reason)
  if (capability !== 'image.generate' || !scope.maxCalls || !request.runId) return

  const calls = skillPackageRepo.listEvents(request.runId).filter((event) => {
    try {
      const payload = JSON.parse(event.payload_json)
      return event.type === 'capability.call' && payload.capability === 'image.generate'
    } catch {
      return false
    }
  }).length
  if (calls >= scope.maxCalls) throw new CapabilityDeniedError(`Image generation budget exhausted (${scope.maxCalls} calls)`)
}

function auditPackageCall(
  request: CapabilityRequest,
  toolId: string,
  toolRunId: string,
  status: 'completed' | 'failed',
  error?: string,
): void {
  if (request.caller !== 'package-runtime' || !request.runId) return
  skillPackageRepo.appendEvent({
    runId: request.runId,
    seq: skillPackageRepo.listEvents(request.runId).length + 1,
    type: 'capability.call',
    payload: {
      runId: request.runId,
      toolRunId,
      capability: request.capability,
      toolId,
      status,
      ...(error ? { error } : {}),
    },
  })
}
