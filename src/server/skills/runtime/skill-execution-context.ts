import type { CapabilityRequest } from '../policy/capability-broker'
import type { CapabilityResult } from '../policy/capability-broker'
import type { ReadAssetResult, ReadTextResult, SkillPackageReader } from '../packages/package-reader'

export type SkillExecutionLimits = {
  readonly maxSteps: number
  readonly maxTokens: number
  readonly maxDurationMs: number
  readonly maxLoadedFiles: number
  readonly maxFileBytes: number
}

export type SkillExecutionContextOptions = {
  readonly runId: string
  readonly instruction: string
  readonly manifest: Record<string, unknown>
  readonly input: Record<string, unknown>
  readonly runContext: Record<string, unknown>
  readonly allowedCapabilities: readonly string[]
  readonly reader: SkillPackageReader
  readonly limits: SkillExecutionLimits
  readonly executeCapability: (request: CapabilityRequest) => Promise<CapabilityResult>
  readonly isCancellationRequested: () => boolean
  readonly onFileLoaded?: (file: { path: string; sha256: string; sizeBytes: number }) => void
  readonly onEvent?: (type: 'step.started' | 'step.completed', payload: Record<string, unknown>) => void
  readonly onUsage?: (usage: { stepCount: number; tokenUsage: number; lastHeartbeatAt: number }) => void
  readonly clock?: () => number
}

/**
 * Run-scoped execution context. It exposes only static package reads and the
 * capability broker; package code never receives a filesystem path or tool
 * registry. All limits are checked here so an executor cannot bypass them by
 * calling the adapter through a different code path.
 */
export class SkillExecutionContext {
  private readonly startedAt: number
  private readonly clock: () => number
  private stepCount = 0
  private tokenUsage = 0
  private loadedFiles = new Set<string>()

  constructor(private readonly options: SkillExecutionContextOptions) {
    this.clock = options.clock ?? Date.now
    this.startedAt = this.clock()
    validateLimits(options.limits)
  }

  get usage(): { stepCount: number; tokenUsage: number; lastHeartbeatAt: number } {
    return { stepCount: this.stepCount, tokenUsage: this.tokenUsage, lastHeartbeatAt: this.clock() }
  }

  toAgentContext() {
    return {
      runId: this.options.runId,
      instruction: this.options.instruction,
      manifest: this.options.manifest,
      input: this.options.input,
      runContext: this.options.runContext,
      maxSteps: this.options.limits.maxSteps,
      maxTokens: this.options.limits.maxTokens,
      allowedCapabilities: [...this.options.allowedCapabilities],
      readText: (relativePath: string) => this.readText(relativePath),
      readAsset: (relativePath: string) => this.readAsset(relativePath),
      executeCapability: (capability: string, input: Record<string, unknown>) => this.executeCapability(capability, input),
      startStep: (title: string) => this.startStep(title),
      completeStep: (title: string) => this.completeStep(title),
      consumeTokens: (count: number) => this.consumeTokens(count),
      isCancellationRequested: () => this.isCancellationRequested(),
    }
  }

  readText(relativePath: string): ReadTextResult {
    this.checkRuntimeBudget()
    const result = this.options.reader.readText(relativePath)
    this.recordFile(result)
    return result
  }

  readAsset(relativePath: string): ReadAssetResult {
    this.checkRuntimeBudget()
    const result = this.options.reader.readAsset(relativePath)
    this.recordFile(result)
    return result
  }

  async executeCapability(capability: string, input: Record<string, unknown>): Promise<CapabilityResult> {
    this.checkRuntimeBudget()
    if (!this.options.allowedCapabilities.includes(capability)) {
      throw new Error(`Capability is not declared by this SkillVersion: ${capability}`)
    }
    return this.options.executeCapability({
      caller: 'package-runtime',
      capability,
      input,
      runId: this.options.runId,
    })
  }

  startStep(title: string): void {
    this.checkRuntimeBudget()
    this.stepCount += 1
    if (this.stepCount > this.options.limits.maxSteps) throw new Error(`Instruction Agent exceeded the ${this.options.limits.maxSteps} step limit`)
    this.options.onEvent?.('step.started', { title })
    this.reportUsage()
  }

  completeStep(title: string): void {
    this.checkRuntimeBudget()
    this.options.onEvent?.('step.completed', { title })
    this.reportUsage()
  }

  consumeTokens(count: number): void {
    if (!Number.isInteger(count) || count < 0) throw new Error('token count must be a non-negative integer')
    this.checkRuntimeBudget()
    this.tokenUsage += count
    if (this.tokenUsage > this.options.limits.maxTokens) throw new Error(`Instruction Agent exceeded the ${this.options.limits.maxTokens} token limit`)
    this.reportUsage()
  }

  isCancellationRequested(): boolean {
    return this.options.isCancellationRequested()
  }

  private recordFile(file: { path: string; sha256: string; sizeBytes: number }): void {
    if (file.sizeBytes > this.options.limits.maxFileBytes) throw new Error(`Package file exceeds the max file size limit: ${file.path}`)
    this.loadedFiles.add(file.path)
    if (this.loadedFiles.size > this.options.limits.maxLoadedFiles) throw new Error('Package read exceeded the per-run file count limit')
    this.options.onFileLoaded?.(file)
  }

  private checkRuntimeBudget(): void {
    if (this.clock() - this.startedAt > this.options.limits.maxDurationMs) throw new Error(`Instruction Agent exceeded the ${this.options.limits.maxDurationMs}ms duration limit`)
    if (this.isCancellationRequested()) throw new Error('Skill run cancellation requested')
  }

  private reportUsage(): void {
    this.options.onUsage?.(this.usage)
  }
}

function validateLimits(limits: SkillExecutionLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  }
}
