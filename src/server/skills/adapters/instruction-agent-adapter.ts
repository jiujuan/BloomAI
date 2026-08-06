import { z } from 'zod'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { SkillPackageReader, type ReadAssetResult, type ReadTextResult } from '../packages/package-reader'
import type { PackageSkillRepository, SkillRunEventRepository } from '../application/ports'
import { SkillExecutionContext } from '../runtime/skill-execution-context'
import { CapabilityApprovalRequiredError, CapabilityDeniedError, CapabilityNotSupportedError, executeCapability, type CapabilityRequest, type CapabilityResult } from '../policy/capability-broker'
import { SkillRunCoordinator, type SkillRun } from '../runtime/skill-run-coordinator'
import { normalizeSkillRunEvent } from '../runtime/skill-run-events'

const DEFAULT_MAX_STEPS = 16
const DEFAULT_MAX_TOKENS = 8_192
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000
const DEFAULT_MAX_LOADED_FILES = 32
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024

const manifestSchema = z.object({
  runtime: z.literal('instruction-agent'),
  requestedCapabilities: z.array(z.object({ capability: z.string().min(1), scope: z.record(z.unknown()).optional() })).default([]),
}).passthrough()

const executionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), output: z.record(z.unknown()), tokensUsed: z.number().int().nonnegative().optional() }),
  z.object({ status: z.literal('completed_with_errors'), output: z.record(z.unknown()), tokensUsed: z.number().int().nonnegative().optional() }),
  z.object({ status: z.literal('waiting_input'), reason: z.string().min(1), tokensUsed: z.number().int().nonnegative().optional() }),
  z.object({ status: z.literal('waiting_approval'), reason: z.string().min(1), capabilities: z.array(z.string().min(1)).default([]), tokensUsed: z.number().int().nonnegative().optional() }),
  z.object({ status: z.literal('cancelled'), tokensUsed: z.number().int().nonnegative().optional() }),
])

export type InstructionAgentExecutionResult = z.infer<typeof executionResultSchema>

export type InstructionAgentExecutionContext = {
  runId: string
  instruction: string
  manifest: Record<string, unknown>
  input: Record<string, unknown>
  runContext: Record<string, unknown>
  maxSteps: number
  maxTokens: number
  allowedCapabilities: string[]
  readText: (relativePath: string) => ReadTextResult
  readAsset: (relativePath: string) => ReadAssetResult
  executeCapability: (capability: string, input: Record<string, unknown>) => Promise<CapabilityResult>
  startStep: (title: string) => void
  completeStep: (title: string) => void
  consumeTokens: (count: number) => void
  isCancellationRequested: () => boolean
  createArtifact?: (data: { kind: string; content: Buffer | string; mimeType?: string; metadata?: Record<string, unknown> }) => Promise<Record<string, unknown>>
}

export type InstructionAgentExecutor = {
  execute: (context: InstructionAgentExecutionContext) => Promise<InstructionAgentExecutionResult> | InstructionAgentExecutionResult
}

export class InstructionAgentAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstructionAgentAdapterError'
  }
}

export class InstructionAgentBudgetError extends InstructionAgentAdapterError {
  constructor(message: string) {
    super(message)
    this.name = 'InstructionAgentBudgetError'
  }
}

export class InstructionAgentAdapter {
  private readonly coordinator: SkillRunCoordinator
  private readonly executePackageCapability: (request: CapabilityRequest) => Promise<CapabilityResult>
  private readonly maxSteps: number
  private readonly maxTokens: number
  private readonly maxDurationMs: number
  private readonly maxLoadedFiles: number
  private readonly maxFileBytes: number
  private readonly packages: Pick<PackageSkillRepository, 'getVersion'> | undefined
  private readonly events: SkillRunEventRepository | undefined

  constructor(options: {
    executor: InstructionAgentExecutor
    coordinator?: SkillRunCoordinator
    executeCapability?: (request: CapabilityRequest) => Promise<CapabilityResult>
    maxSteps?: number
    maxTokens?: number
    maxDurationMs?: number
    maxLoadedFiles?: number
    maxFileBytes?: number
    packages?: Pick<PackageSkillRepository, 'getVersion'>
    events?: SkillRunEventRepository
  }) {
    this.executor = options.executor
    this.coordinator = options.coordinator ?? new SkillRunCoordinator()
    this.executePackageCapability = options.executeCapability ?? executeCapability
    this.maxSteps = positiveInteger(options.maxSteps ?? DEFAULT_MAX_STEPS, 'maxSteps')
    this.maxTokens = positiveInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens')
    this.maxDurationMs = positiveInteger(options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS, 'maxDurationMs')
    this.maxLoadedFiles = positiveInteger(options.maxLoadedFiles ?? DEFAULT_MAX_LOADED_FILES, 'maxLoadedFiles')
    this.maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, 'maxFileBytes')
    this.packages = options.packages
    this.events = options.events
  }

  private readonly executor: InstructionAgentExecutor

  async run(runId: string): Promise<SkillRun> {
    let run = this.coordinator.getRun(runId)
    try {
      if (run.cancelRequested) return this.cancel(run)
      const version = this.packages?.getVersion(run.skillVersionId) ?? skillPackageRepo.getVersion(run.skillVersionId)
      if (!version) throw new InstructionAgentAdapterError(`SkillVersion not found: ${run.skillVersionId}`)
      const manifestValue = 'manifest' in version ? JSON.stringify(version.manifest) : version.manifest_json
      const packagePath = 'packagePath' in version ? version.packagePath : version.package_path
      const compatible = 'isCompatible' in version ? version.isCompatible : version.is_compatible === 1
      if (!compatible) throw new InstructionAgentAdapterError(`SkillVersion is incompatible: ${run.skillVersionId}`)
      const manifest = parseManifest(manifestValue)
      const reader = new SkillPackageReader(packagePath, { maxFilesPerRun: this.maxLoadedFiles, maxReadBytes: this.maxFileBytes })
      const entry = reader.readEntry()
      this.recordFileLoaded(run.id, entry)

      run = this.startRunning(run)
      if (run.cancelRequested) return this.cancel(run)

      const allowedCapabilities = [...new Set(manifest.requestedCapabilities.map((entry) => entry.capability))]
      const executionContext = new SkillExecutionContext({
        runId: run.id,
        instruction: entry.content,
        manifest,
        input: run.input,
        runContext: run.context,
        allowedCapabilities,
        reader,
        limits: {
          maxSteps: this.maxSteps,
          maxTokens: this.maxTokens,
          maxDurationMs: this.maxDurationMs,
          maxLoadedFiles: this.maxLoadedFiles,
          maxFileBytes: this.maxFileBytes,
        },
        executeCapability: (request) => this.executePackageCapability({
          ...request,
          sessionId: run.sessionId ?? undefined,
        }),
        isCancellationRequested: () => this.coordinator.getRun(run.id).cancelRequested,
        onFileLoaded: (file) => this.recordFileLoaded(run.id, file),
        onEvent: (type, payload) => this.recordEvent(run.id, type, payload),
        onUsage: (usage) => this.persistUsage(run.id, usage),
      })

      const result = executionResultSchema.parse(await this.executor.execute(executionContext.toAgentContext()))
      if (result.tokensUsed !== undefined) executionContext.consumeTokens(result.tokensUsed)
      const latest = this.coordinator.getRun(run.id)
      if (latest.cancelRequested || result.status === 'cancelled') return this.cancel(latest)
      if (result.status === 'waiting_input') {
        return this.coordinator.transition(run.id, 'waiting_input', { expectedRevision: latest.revision, waitingReason: result.reason })
      }
      if (result.status === 'waiting_approval') {
        return this.coordinator.transition(run.id, 'waiting_approval', {
          expectedRevision: latest.revision,
          waitingReason: result.reason,
          approvalCapabilities: result.capabilities,
        })
      }
      if (result.status === 'completed_with_errors') {
        return this.coordinator.transition(run.id, 'completed_with_errors', { expectedRevision: latest.revision, output: result.output })
      }
      return this.coordinator.transition(run.id, 'completed', { expectedRevision: latest.revision, output: result.output })
    } catch (error) {
      const latest = this.coordinator.getRun(runId)
      if (latest.cancelRequested) return this.cancel(latest)
      const capabilityMapping = mapCapabilityErrorToRunAction(error)
      if (capabilityMapping && (latest.status === 'validating' || latest.status === 'running')) {
        return this.coordinator.transition(runId, capabilityMapping.targetStatus, {
          expectedRevision: latest.revision,
          waitingReason: capabilityMapping.waitingReason,
          requiredAction: capabilityMapping.requiredAction,
          errorCode: capabilityMapping.errorCode,
          errorMessage: capabilityMapping.errorMessage,
        })
      }
      if (latest.status === 'validating' || latest.status === 'running') {
        return this.coordinator.transition(runId, 'failed', {
          expectedRevision: latest.revision,
          errorCode: isBudgetError(error) ? 'AGENT_BUDGET_EXCEEDED' : 'INSTRUCTION_AGENT_FAILED',
          errorMessage: error instanceof Error ? error.message : 'Instruction Agent execution failed',
        })
      }
      throw error
    }
  }

  private startRunning(run: SkillRun): SkillRun {
    if (run.status === 'running') return run
    if (run.status !== 'validating' && run.status !== 'waiting_input') {
      throw new InstructionAgentAdapterError(`Run is not ready for Instruction Agent execution: ${run.status}`)
    }
    return this.coordinator.transition(run.id, 'running', { expectedRevision: run.revision })
  }

  private cancel(run: SkillRun): SkillRun {
    if (run.status === 'cancelled') return run
    if (run.status !== 'validating' && run.status !== 'running') throw new InstructionAgentAdapterError(`Run cannot be cancelled from: ${run.status}`)
    return this.coordinator.transition(run.id, 'cancelled', { expectedRevision: run.revision })
  }

  private recordFileLoaded(runId: string, file: { path: string; sha256: string; sizeBytes: number }): void {
    this.recordEvent(runId, 'package.file_loaded', file)
  }

  private recordEvent(runId: string, type: 'package.file_loaded' | 'step.started' | 'step.completed', payload: Record<string, unknown>): void {
    const event = normalizeSkillRunEvent({ type, payload })
    if (this.events) {
      this.events.appendEvent({ runId, seq: this.events.nextSequence(runId), ...event })
      return
    }
    skillPackageRepo.appendEvent({ runId, seq: skillPackageRepo.listEvents(runId).length + 1, ...event })
  }

  private persistUsage(runId: string, usage: { stepCount: number; tokenUsage: number; lastHeartbeatAt: number }): void {
    const run = this.coordinator.getRun(runId)
    if (run.status !== 'running') return
    try {
      this.coordinator.updateExecutionMetrics(runId, run.revision, usage)
    } catch {
      // Usage is diagnostic; a concurrent terminal transition remains authoritative.
    }
  }
}

function parseManifest(value: string): z.infer<typeof manifestSchema> {
  try {
    return manifestSchema.parse(JSON.parse(value))
  } catch {
    throw new InstructionAgentAdapterError('SkillVersion manifest is invalid for the Instruction Agent runtime')
  }
}

function isBudgetError(error: unknown): boolean {
  return error instanceof InstructionAgentBudgetError || error instanceof Error && /exceeded the .* (step|token|duration) limit|duration limit|file count limit|max file size limit/.test(error.message)
}

function mapCapabilityErrorToRunAction(error: unknown): {
  targetStatus: 'waiting_approval' | 'failed'
  waitingReason?: string
  requiredAction?: Record<string, unknown> | null
  errorCode?: string
  errorMessage?: string
} | undefined {
  if (error instanceof CapabilityApprovalRequiredError) {
    const details = error.details
    return {
      targetStatus: 'waiting_approval',
      waitingReason: error.message,
      requiredAction: {
        type: 'approval',
        ...(details?.capability ? { capability: details.capability } : {}),
        ...(details?.grantId ? { grantId: details.grantId } : {}),
        prompt: { kind: 'confirm', label: error.message },
        ...(details?.requestedScope ? { requestedScope: details.requestedScope } : {}),
        ...(details?.expiresAt !== undefined ? { expiresAt: details.expiresAt } : {}),
      },
    }
  }
  if (error instanceof CapabilityDeniedError) {
    return {
      targetStatus: 'failed',
      errorCode: error.details?.reasonCode === 'CAPABILITY_BUDGET_EXHAUSTED' ? 'CAPABILITY_BUDGET_EXHAUSTED' : 'CAPABILITY_DENIED',
      errorMessage: error.message,
    }
  }
  if (error instanceof CapabilityNotSupportedError) {
    return {
      targetStatus: 'failed',
      errorCode: 'CAPABILITY_NOT_SUPPORTED',
      errorMessage: error.message,
    }
  }
  return undefined
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new InstructionAgentAdapterError(`${label} must be a positive integer`)
  return value
}
