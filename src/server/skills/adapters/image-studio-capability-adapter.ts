import { z } from 'zod'
import { imageSessionRepo, type ImageSession } from '../../db/repositories/image-session.repo'
import { imageGenerationRepo } from '../../db/repositories/image-generation.repo'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { generateForSession, type GenerateForSessionInput } from '../../services/image-studio.service'
import { ArtifactStore } from '../artifacts/artifact-store'

export type ImageStudioItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'
export const imageReferenceMetadataSchema = z.object({
  artifactId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sizeBytes: z.number().int().nonnegative().max(10 * 1024 * 1024),
}).strict()

export type ImageReferenceMetadata = z.infer<typeof imageReferenceMetadataSchema>
export type ImageReferenceInput = string | ImageReferenceMetadata
export type ImageStudioItemInput = Omit<GenerateForSessionInput, 'sessionId' | 'referenceImages'> & {
  id: string
  referenceImages?: ImageReferenceInput[]
}
export type ImageStudioBatchInput = {
  runId: string
  skillVersionId?: string
  grantId?: string
  count?: number
  items: ImageStudioItemInput[]
  imageSessionId?: string
  title?: string
}
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
  private readonly skillVersionId?: string
  private readonly grantId?: string
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
    const run = skillPackageRepo.getRun(input.runId)
    if (!run) throw new ImageStudioCapabilityAdapterError(`Skill run not found: ${input.runId}`)
    if (input.skillVersionId && input.skillVersionId !== run.skill_version_id) {
      throw new ImageStudioCapabilityAdapterError('Image capability skillVersionId does not match the Package Run')
    }
    if (input.grantId !== undefined && (!input.grantId.trim() || input.grantId.length > 256)) {
      throw new ImageStudioCapabilityAdapterError('Image capability grantId is invalid')
    }
    if (!input.items.length) throw new ImageStudioCapabilityAdapterError('At least one image item is required')
    if (input.items.length > 4) throw new ImageStudioCapabilityAdapterError('Image capability count cannot exceed 4')
    if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > 4 || input.count !== input.items.length)) {
      throw new ImageStudioCapabilityAdapterError('Image capability count must match items and be between 1 and 4')
    }
    const ids = new Set<string>()
    this.items = input.items.map((item) => {
      if (!item.id || ids.has(item.id)) throw new ImageStudioCapabilityAdapterError(`Image item id must be unique: ${item.id}`)
      if (!item.prompt.trim()) throw new ImageStudioCapabilityAdapterError(`Image item prompt is required: ${item.id}`)
      if (item.prompt.trim().length > 20_000) throw new ImageStudioCapabilityAdapterError(`Image item prompt is too long: ${item.id}`)
      if (!item.model.trim() || item.model.trim().length > 200) throw new ImageStudioCapabilityAdapterError(`Image item model is invalid: ${item.id}`)
      if (item.size !== undefined && !/^\d{2,5}x\d{2,5}$/.test(item.size)) throw new ImageStudioCapabilityAdapterError(`Image item size is invalid: ${item.id}`)
      const referenceImages = normalizeReferenceImages(item.referenceImages, run.id)
      ids.add(item.id)
      return { id: item.id, prompt: item.prompt, status: 'pending' as const, attempts: 0, input: { ...item, referenceImages } }
    })
    this.runId = input.runId
    this.skillVersionId = input.skillVersionId ?? run.skill_version_id
    this.grantId = input.grantId
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
      if (session.skill_run_id && session.skill_run_id !== this.runId) {
        throw new ImageStudioCapabilityAdapterError('Image Studio session belongs to another Package Run')
      }
      this.session = imageSessionRepo.update(id, {
        skill_run_id: this.runId,
        skill_version_id: this.skillVersionId ?? null,
        grant_id: this.grantId ?? null,
      })!
      skillPackageRepo.setRunImageSessionId(this.runId, session.id)
      return
    }
    this.session = imageSessionRepo.create({ title: this.title, skill_run_id: this.runId, skill_version_id: this.skillVersionId ?? null, grant_id: this.grantId ?? null })
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
      const generation = await this.generateForSession({
        ...item.input,
        referenceImages: item.input.referenceImages?.map((reference) => typeof reference === 'string' ? reference : reference.artifactId),
        prompt: item.prompt,
        sessionId: this.session!.id,
        skillRunId: this.runId,
        skillVersionId: this.skillVersionId,
        grantId: this.grantId,
      })
      imageGenerationRepo.update(generation.id, {
        skill_run_id: this.runId,
        skill_version_id: this.skillVersionId ?? null,
        grant_id: this.grantId ?? null,
      })
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
      metadata: { itemId: item.id, attempt: item.attempts, imageSessionId: this.session!.id, skillVersionId: this.skillVersionId, grantId: this.grantId },
    })
    store.writeImageReference({
      runId: this.runId, fileName: `${stem}.json`,
      reference: { itemId: item.id, generationId, imageSessionId: this.session!.id, status: item.status },
      metadata: { itemId: item.id, generationId, attempt: item.attempts, skillVersionId: this.skillVersionId, grantId: this.grantId },
    })
  }

  private writeManifest(): void {
    this.manifestRevision += 1
    const existingPaths = new Set(skillPackageRepo.listArtifacts(this.runId).map((artifact) => artifact.path))
    let fileName = manifestFileName(this.manifestRevision)
    while (existingPaths.has(fileName)) fileName = manifestFileName(++this.manifestRevision)
    const lines = [
      '# Illustrations', '', `Image Studio session: ${this.session!.id}`, '',
      '| Item | Status | Generation | Prompt | Error |',
      '| --- | --- | --- | --- | --- |',
      ...this.items.map((item) => `| ${escapeMarkdown(item.id)} | ${item.status} | ${item.generationId ?? ''} | ${escapeMarkdown(item.prompt)} | ${escapeMarkdown(item.error ?? '')} |`),
      '',
    ]
    new ArtifactStore().writeText({
      runId: this.runId, kind: 'markdown', fileName, content: lines.join('\n'),
      metadata: { imageSessionId: this.session!.id, skillVersionId: this.skillVersionId, grantId: this.grantId, status: this.result().status, revision: this.manifestRevision },
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

function manifestFileName(revision: number): string {
  return revision === 1 ? 'illustrations.md' : `illustrations-${revision}.md`
}

function artifactStem(itemId: string, attempt: number): string {
  const safe = itemId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'
  return `image-${safe}-attempt-${attempt}`
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}


function normalizeReferenceImages(value: ImageReferenceInput[] | undefined, runId: string): string[] | undefined {
  if (!value) return undefined
  if (value.length > 4) throw new ImageStudioCapabilityAdapterError('At most four reference images are allowed')
  return value.map((reference) => {
    if (typeof reference === 'string') {
      if (!reference.trim() || reference.length > 256 || /[\u0000-\u001f]/.test(reference)) {
        throw new ImageStudioCapabilityAdapterError('Reference image id is invalid')
      }
      return reference
    }
    const parsed = imageReferenceMetadataSchema.safeParse(reference)
    if (!parsed.success) throw new ImageStudioCapabilityAdapterError(`Invalid reference image metadata: ${parsed.error.issues[0]?.message ?? 'invalid metadata'}`)
    if (parsed.data.runId !== runId) throw new ImageStudioCapabilityAdapterError('Reference image belongs to another Package Run')
    if (/[/\\]/.test(parsed.data.artifactId) || parsed.data.artifactId === '.' || parsed.data.artifactId === '..') {
      throw new ImageStudioCapabilityAdapterError('Reference image artifactId is invalid')
    }
    return parsed.data.artifactId
  })
}
