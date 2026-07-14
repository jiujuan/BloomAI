import { z } from 'zod'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { SkillPackageReader, type ReadAssetResult, type ReadTextResult } from '../packages/package-reader'
import { executeCapability, type CapabilityRequest, type CapabilityResult } from '../policy/capability-broker'
import { SkillRunCoordinator, type SkillRun } from '../runtime/skill-run-coordinator'

const DEFAULT_MAX_STEPS = 16
const DEFAULT_MAX_TOKENS = 8_192

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

  constructor(options: {
    executor: InstructionAgentExecutor
    coordinator?: SkillRunCoordinator
    executeCapability?: (request: CapabilityRequest) => Promise<CapabilityResult>
    maxSteps?: number
    maxTokens?: number
  }) {
    this.executor = options.executor
    this.coordinator = options.coordinator ?? new SkillRunCoordinator()
    this.executePackageCapability = options.executeCapability ?? executeCapability
    this.maxSteps = positiveInteger(options.maxSteps ?? DEFAULT_MAX_STEPS, 'maxSteps')
    this.maxTokens = positiveInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens')
  }

  private readonly executor: InstructionAgentExecutor

  async run(runId: string): Promise<SkillRun> {
    let run = this.coordinator.getRun(runId)
    try {
      if (run.cancelRequested) return this.cancel(run)
      const version = skillPackageRepo.getVersion(run.skillVersionId)
      if (!version) throw new InstructionAgentAdapterError(`SkillVersion not found: ${run.skillVersionId}`)
      if (version.is_compatible !== 1) throw new InstructionAgentAdapterError(`SkillVersion is incompatible: ${run.skillVersionId}`)
      const manifest = parseManifest(version.manifest_json)
      const reader = new SkillPackageReader(version.package_path)
      const entry = reader.readEntry()
      this.recordFileLoaded(run.id, entry)

      run = this.startRunning(run)
      if (run.cancelRequested) return this.cancel(run)

      let steps = 0
      let tokens = 0
      const allowedCapabilities = [...new Set(manifest.requestedCapabilities.map((entry) => entry.capability))]
      const context: InstructionAgentExecutionContext = {
        runId: run.id,
        instruction: entry.content,
        manifest,
        input: run.input,
        runContext: run.context,
        maxSteps: this.maxSteps,
        maxTokens: this.maxTokens,
        allowedCapabilities,
        readText: (relativePath) => {
          const file = reader.readText(relativePath)
          this.recordFileLoaded(run.id, file)
          return file
        },
        readAsset: (relativePath) => {
          const file = reader.readAsset(relativePath)
          this.recordFileLoaded(run.id, file)
          return file
        },
        executeCapability: async (capability, input) => {
          if (!allowedCapabilities.includes(capability)) {
            throw new InstructionAgentAdapterError(`Capability is not declared by this SkillVersion: ${capability}`)
          }
          return this.executePackageCapability({
            caller: 'package-runtime',
            capability,
            input,
            runId: run.id,
            sessionId: run.sessionId ?? undefined,
          })
        },
        startStep: (title) => {
          steps += 1
          if (steps > this.maxSteps) throw new InstructionAgentBudgetError(`Instruction Agent exceeded the ${this.maxSteps} step limit`)
          this.recordEvent(run.id, 'step.started', { title })
        },
        completeStep: (title) => this.recordEvent(run.id, 'step.completed', { title }),
        consumeTokens: (count) => {
          tokens += positiveInteger(count, 'token count')
          if (tokens > this.maxTokens) throw new InstructionAgentBudgetError(`Instruction Agent exceeded the ${this.maxTokens} token limit`)
        },
        isCancellationRequested: () => this.coordinator.getRun(run.id).cancelRequested,
      }

      const result = executionResultSchema.parse(await this.executor.execute(context))
      if (result.tokensUsed !== undefined) context.consumeTokens(result.tokensUsed)
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
      if (latest.status === 'validating' || latest.status === 'running') {
        return this.coordinator.transition(runId, 'failed', {
          expectedRevision: latest.revision,
          errorCode: error instanceof InstructionAgentBudgetError ? 'AGENT_BUDGET_EXCEEDED' : 'INSTRUCTION_AGENT_FAILED',
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
    skillPackageRepo.appendEvent({ runId, seq: skillPackageRepo.listEvents(runId).length + 1, type, payload })
  }
}

function parseManifest(value: string): z.infer<typeof manifestSchema> {
  try {
    return manifestSchema.parse(JSON.parse(value))
  } catch {
    throw new InstructionAgentAdapterError('SkillVersion manifest is invalid for the Instruction Agent runtime')
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new InstructionAgentAdapterError(`${label} must be a positive integer`)
  return value
}
