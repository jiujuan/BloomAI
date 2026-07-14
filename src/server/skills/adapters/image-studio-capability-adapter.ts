import { imageSessionRepo, type ImageSession } from '../../db/repositories/image-session.repo'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { generateForSession, type GenerateForSessionInput } from '../../services/image-studio.service'
import { ArtifactStore } from '../artifacts/artifact-store'

export type ImageStudioItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'
export type ImageStudioItemInput = Omit<GenerateForSessionInput, 'sessionId'> & { id: string }
export type ImageStudioBatchInput = { runId: string; items: ImageStudioItemInput[]; imageSessionId?: string; title?: string }
export type ImageStudioItemResult = { id: string; prompt: string; status: ImageStudioItemStatus; generationId?: string; error?: string; attempts: number }
export type ImageStudioBatchResult = { status: 'completed' | 'completed_with_errors' | 'cancelled'; imageSessionId: string; items: ImageStudioItemResult[] }
type BatchItem = ImageStudioItemResult & { input: ImageStudioItemInput }
type GenerateForSession = (input: GenerateForSessionInput) => ReturnType<typeof generateForSession>

export class ImageStudioCapabilityAdapterError extends Error {
  constructor(message: string) { super(message); this.name = 'ImageStudioCapabilityAdapterError' }
}

/** Adapts package image batches to Image Studio's durable session and generation records. */
export class ImageStudioCapabilityAdapter {
  private readonly generate: GenerateForSession
  private readonly concurrency: number

  constructor(options: { generateForSession?: GenerateForSession; concurrency?: number } = {}) {
    this.generate = options.generateForSession ?? generateForSession
    this.concurrency = positiveInteger(options.concurrency ?? 2, 'concurrency')
  }

  createBatch(input: ImageStudioBatchInput): ImageStudioBatch {
    return new ImageStudioBatch({ input, generateForSession: this.generate, concurrency: this.concurrency })
  }

  async run(input: ImageStudioBatchInput): Promise<ImageStudioBatchResult> {
    return this.createBatch(input).run()
  }
}

export class ImageStudioBatch {
  private readonly runId: string
  private readonly requestedSessionId?: string
  private readonly title?: string
  private readonly generateForSession: GenerateForSession
  private readonly concurrency: number
  private readonly items: BatchItem[]
  private session: ImageSession | undefined
  private cancelled = false
  private manifestRevision = 0

  constructor(options: { input: ImageStudioBatchInput; generateForSession: GenerateForSession; concurrency: number }) {
    const { input } = options
    if (!skillPackageRepo.getRun(input.runId)) throw new ImageStudioCapabilityAdapterError(`Skill run not found: ${input.runId}`)
    if (!input.items.length) throw new ImageStudioCapabilityAdapterError('At least one image item is required')
    const ids = new Set<string>()
    this.items = input.items.map((item) => {
      if (!item.id || ids.has(item.id)) throw new ImageStudioCapabilityAdapterError(`Image item id must be unique: ${item.id}`)
      if (!item.prompt.trim()) throw new ImageStudioCapabilityAdapterError(`Image item prompt is required: ${item.id}`)
      if (!item.model.trim()) throw new ImageStudioCapabilityAdapterError(`Image item model is required: ${item.id}`)
      ids.add(item.id)
      return { id: item.id, prompt: item.prompt, status: 'pending' as const, attempts: 0, input: { ...item } }
    })
    this.runId = input.runId
    this.requestedSessionId = input.imageSessionId
    this.title = input.title
    this.generateForSession = options.generateForSession
    this.concurrency = options.concurrency
  }

  async run(): Promise<ImageStudioBatchResult> {
    this.ensureSession()
    await this.processPendingItems()
    this.writeManifest()
    return this.result()
  }

  async retry(itemId: string, editedPrompt?: string): Promise<ImageStudioBatchResult> {
    this.ensureSession()
    const item = this.findItem(itemId)
    if (item.status === 'running') throw new ImageStudioCapabilityAdapterError(`Image item is still running: ${itemId}`)
    if (editedPrompt !== undefined) {
      if (!editedPrompt.trim()) throw new ImageStudioCapabilityAdapterError(`Image item prompt is required: ${itemId}`)
      item.prompt = editedPrompt
      item.input.prompt = editedPrompt
    }
    item.status = 'pending'
    item.error = undefined
    item.generationId = undefined
    this.cancelled = false
    await this.processPendingItems()
    this.writeManifest()
    return this.result()
  }

  skip(itemId: string): ImageStudioBatchResult {
    const item = this.findItem(itemId)
    if (item.status === 'running') throw new ImageStudioCapabilityAdapterError(`Image item is still running: ${itemId}`)
    if (item.status === 'completed') throw new ImageStudioCapabilityAdapterError(`Completed image item cannot be skipped: ${itemId}`)
    item.status = 'skipped'
    item.error = undefined
    return this.result()
  }

  cancel(): ImageStudioBatchResult {
    this.cancelled = true
    for (const item of this.items) if (item.status === 'pending') item.status = 'cancelled'
    return this.result()
  }

  private ensureSession(): void {
    if (this.session) return
    const run = skillPackageRepo.getRun(this.runId)
    if (!run) throw new ImageStudioCapabilityAdapterError(`Skill run not found: ${this.runId}`)
    const id = this.requestedSessionId ?? run.image_session_id
    if (id) {
      const session = imageSessionRepo.get(id)
      if (!session) throw new ImageStudioCapabilityAdapterError(`Image Studio session not found: ${id}`)
      this.session = session
      skillPackageRepo.setRunImageSessionId(this.runId, session.id)
      return
    }
    this.session = imageSessionRepo.create({ title: this.title })
    skillPackageRepo.setRunImageSessionId(this.runId, this.session.id)
  }

  private async processPendingItems(): Promise<void> {
    const pending = this.items.filter((item) => item.status === 'pending')
    let next = 0
    const workers = Array.from({ length: Math.min(this.concurrency, pending.length) }, async () => {
      while (!this.cancelled) {
        const item = pending[next++]
        if (!item) return
        await this.generateItem(item)
      }
    })
    await Promise.all(workers)
    if (this.cancelled) for (const item of this.items) if (item.status === 'pending') item.status = 'cancelled'
  }

  private async generateItem(item: BatchItem): Promise<void> {
    item.status = 'running'
    item.attempts += 1
    try {
      const generation = await this.generateForSession({ ...item.input, prompt: item.prompt, sessionId: this.session!.id })
      item.generationId = generation.id
      if (generation.status === 'completed') {
        item.status = 'completed'
        item.error = undefined
      } else {
        item.status = 'failed'
        item.error = generation.error_msg || 'Image generation failed'
      }
      this.writeItemArtifacts(item, generation.id)
    } catch (error) {
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : 'Image generation failed'
    }
  }

  private writeItemArtifacts(item: BatchItem, generationId: string): void {
    const store = new ArtifactStore()
    const stem = artifactStem(item.id, item.attempts)
    store.writeText({
      runId: this.runId, kind: 'prompt', fileName: `${stem}.txt`, content: item.prompt,
      metadata: { itemId: item.id, attempt: item.attempts, imageSessionId: this.session!.id },
    })
    store.writeImageReference({
      runId: this.runId, fileName: `${stem}.json`,
      reference: { itemId: item.id, generationId, imageSessionId: this.session!.id, status: item.status },
      metadata: { itemId: item.id, generationId, attempt: item.attempts },
    })
  }

  private writeManifest(): void {
    this.manifestRevision += 1
    const fileName = this.manifestRevision === 1 ? 'illustrations.md' : `illustrations-${this.manifestRevision}.md`
    const lines = [
      '# Illustrations', '', `Image Studio session: ${this.session!.id}`, '',
      '| Item | Status | Generation | Prompt | Error |',
      '| --- | --- | --- | --- | --- |',
      ...this.items.map((item) => `| ${escapeMarkdown(item.id)} | ${item.status} | ${item.generationId ?? ''} | ${escapeMarkdown(item.prompt)} | ${escapeMarkdown(item.error ?? '')} |`),
      '',
    ]
    new ArtifactStore().writeText({
      runId: this.runId, kind: 'markdown', fileName, content: lines.join('\n'),
      metadata: { imageSessionId: this.session!.id, status: this.result().status, revision: this.manifestRevision },
    })
  }

  private findItem(itemId: string): BatchItem {
    const item = this.items.find((candidate) => candidate.id === itemId)
    if (!item) throw new ImageStudioCapabilityAdapterError(`Image item not found: ${itemId}`)
    return item
  }

  private result(): ImageStudioBatchResult {
    const status = this.cancelled ? 'cancelled' : this.items.every((item) => item.status === 'completed') ? 'completed' : 'completed_with_errors'
    return {
      status,
      imageSessionId: this.session?.id ?? this.requestedSessionId ?? '',
      items: this.items.map(({ input: _input, ...item }) => ({ ...item })),
    }
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new ImageStudioCapabilityAdapterError(`${label} must be a positive integer`)
  return value
}

function artifactStem(itemId: string, attempt: number): string {
  const safe = itemId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'
  return `image-${safe}-attempt-${attempt}`
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}
