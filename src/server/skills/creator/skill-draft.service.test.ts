import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSkillDraftService, type SkillDraftRepository } from './skill-draft.service'

type Draft = any

type AtomicPublishInput = {
  package: { name: string; description: string; sourceType: string; sourceUri?: string | null; sourceRef?: string | null }
  version: { version: string; manifest: Record<string, unknown>; manifestHash: string; packagePath: string; sourceSnapshot: Record<string, unknown> }
  snapshot: { filesManifest: Record<string, unknown>; totalBytes: number; fileCount: number; snapshotRoot: string; snapshotHash: string }
  installation: { status: string; enabled?: boolean }
  draft: { id: string; ownerId: string; expectedRevision: number; validation: Record<string, unknown> }
}

function repoFixture() {
  const drafts = new Map<string, Draft>()
  const published: any[] = []
  const repo: SkillDraftRepository = {
    createDraft(input) {
      const now = Date.now()
      const row = { id: `draft-${drafts.size + 1}`, ownerId: input.ownerId, status: 'draft' as const, revision: 1, content: input.content, validation: null, baseVersionId: input.baseVersionId ?? null, publishedVersionId: null, createdAt: now, updatedAt: now }
      drafts.set(row.id, row)
      return row
    },
    getDraft(id) { return drafts.get(id) },
    updateDraftCas(input) {
      const row = drafts.get(input.id)
      if (!row || row.ownerId !== input.ownerId || row.revision !== input.expectedRevision || row.status !== 'draft') return undefined
      Object.assign(row, { content: input.content, revision: row.revision + 1, updatedAt: Date.now() })
      return row
    },
    saveValidation(input) {
      const row = drafts.get(input.id)
      if (!row) return undefined
      row.validation = input.validation
      return row
    },
    markPublished(input) {
      const row = drafts.get(input.id)
      if (!row || row.ownerId !== input.ownerId || row.status !== 'draft') return undefined
      Object.assign(row, { status: 'published', publishedVersionId: input.versionId, validation: input.validation, updatedAt: Date.now() })
      return row
    },
    discardDraft(input) {
      const row = drafts.get(input.id)
      if (!row || row.ownerId !== input.ownerId) return undefined
      row.status = 'discarded'
      row.updatedAt = Date.now()
      return row
    },
    publish(input) {
      const result = { package: { id: `package-${published.length + 1}` }, version: { id: `version-${published.length + 1}`, manifest_hash: input.version.manifestHash }, snapshot: { id: `snapshot-${published.length + 1}`, snapshot_hash: input.snapshot.snapshotHash }, installation: { id: `installation-${published.length + 1}`, enabled: 0 } }
      published.push(input)
      return result
    },
    publishDraftTransaction(input) {
      const row = drafts.get(input.draft.id)
      if (!row || row.ownerId !== input.draft.ownerId || row.status !== 'draft' || row.revision !== input.draft.expectedRevision) {
        throw Object.assign(new Error('Draft changed during publish'), { code: 'REVISION_CONFLICT' })
      }
      const index = published.length + 1
      const result = {
        package: { id: `package-${index}` },
        version: { id: `version-${index}`, manifest_hash: input.version.manifestHash },
        snapshot: { id: `snapshot-${index}`, snapshot_hash: input.snapshot.snapshotHash },
        installation: { id: `installation-${index}`, enabled: input.installation.enabled === true ? 1 : 0 },
      }
      published.push(input)
      Object.assign(row, { status: 'published', publishedVersionId: result.version.id, validation: input.draft.validation, updatedAt: Date.now() })
      return result
    },
  }
  return { repo, drafts, published }
}

function attachAtomicPublisher(repo: SkillDraftRepository, drafts: Map<string, Draft>, atomicPublished: AtomicPublishInput[]) {
  const atomicCalls: AtomicPublishInput[] = []
  ;(repo as any).publishDraftTransaction = (input: AtomicPublishInput) => {
    atomicCalls.push(input)
    const row = drafts.get(input.draft.id)
    if (!row || row.ownerId !== input.draft.ownerId || row.status !== 'draft' || row.revision !== input.draft.expectedRevision) {
      throw Object.assign(new Error('Draft changed during publish'), { code: 'REVISION_CONFLICT' })
    }
    const index = atomicPublished.length + 1
    const result = {
      package: { id: `atomic-package-${index}` },
      version: { id: `atomic-version-${index}`, manifest_hash: input.version.manifestHash },
      snapshot: { id: `atomic-snapshot-${index}`, snapshot_hash: input.snapshot.snapshotHash },
      installation: { id: `atomic-installation-${index}`, enabled: input.installation.enabled === true ? 1 : 0 },
    }
    atomicPublished.push(input)
    Object.assign(row, { status: 'published', publishedVersionId: result.version.id, validation: input.draft.validation, updatedAt: Date.now() })
    return result
  }
  return atomicCalls
}

const validContent = {
  name: 'Writer', slug: 'writer', version: '1.0.0', description: 'Writes clearly',
  skillMd: '# Writer\n\nWrite a clear answer.', references: { 'references/style.md': '# Style' }, assets: [],
  capabilities: [], visibility: 'private' as const, author: 'alice',
}

describe('skill draft service', () => {
  it('creates, reads, and updates drafts with CAS ownership', () => {
    const { repo } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    expect(created.revision).toBe(1)
    expect(service.getDraft(created.id, 'alice')?.content.name).toBe('Writer')
    expect(() => service.updateDraft(created.id, 'bob', { description: 'nope' }, 1)).toThrow(/owner/)
    expect(() => service.updateDraft(created.id, 'alice', { description: 'changed' }, 99)).toThrow(/revision/)
    const updated = service.updateDraft(created.id, 'alice', { description: 'changed' }, 1)
    expect(updated.revision).toBe(2)
    expect(updated.content.description).toBe('changed')
  })

  it('normalizes Creator drafts to Package Runtime and rejects Legacy Runtime declarations', () => {
    const { repo } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    expect(created.content.runtimeKind).toBe('package')
    expect(() => service.createDraft({ ownerId: 'alice', content: { ...validContent, runtimeKind: 'legacy' } })).toThrow(/Invalid draft content/)
    expect(() => service.createDraft({ ownerId: 'alice', content: { ...validContent, runtime: 'legacy' } })).toThrow(/Invalid draft content/)
  })

  it('validates markdown through the canonical manifest pipeline and separates errors from warnings', () => {
    const { repo } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: { ...validContent, version: 'draft-version', skillMd: '---\ncapabilities:\n  shell.execute: true\n---\n# Unsafe' } })
    const result = service.validateDraft(created.id, 'alice')
    expect(result.valid).toBe(false)
    expect(result.errors.some((error: any) => error.code === 'UNSUPPORTED_DECLARATION')).toBe(true)
    expect(result.errors.every((error: any) => error.level === 'error')).toBe(true)
    expect(result.warnings.some((warning: any) => warning.code === 'NON_SEMVER_VERSION')).toBe(true)
    expect(result.warnings.every((warning: any) => warning.level === 'warning')).toBe(true)
    expect(result.securityFindings).toContain('capability:shell.execute')
  })

  it('rejects Legacy Runtime declared in Creator markdown before publish', () => {
    const { repo } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: { ...validContent, skillMd: '---\nruntime: legacy\n---\n# Writer' } })
    const result = service.validateDraft(created.id, 'alice')
    expect(result.valid).toBe(false)
    expect(result.errors.some((error: any) => error.message.includes('runtime:legacy'))).toBe(true)
    expect(() => service.publishDraft(created.id, 'alice')).toThrow(/validation failed/)
    expect(repo.getDraft(created.id)?.status).toBe('draft')
  })

  it('publishes an immutable version and keeps published drafts read-only', () => {
    const { repo, published } = repoFixture()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-draft-service-'))
    const service = createSkillDraftService({ repo, packageDataRoot: root })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    const result = service.publishDraft(created.id, 'alice', { enable: false })
    expect(result.versionId).toBe('version-1')
    expect(result.installationEnabled).toBe(false)
    expect(published[0].snapshot.filesManifest['SKILL.md']).toBeTruthy()
    expect(() => service.updateDraft(created.id, 'alice', { description: 'new draft' }, 1)).toThrow(/revision|published/i)
    expect(published[0].version.manifest.description).toBe('Writes clearly')
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('publishes enabled installations through one draft revision CAS transaction', () => {
    const { repo, drafts, published } = repoFixture()
    const atomicPublished: AtomicPublishInput[] = []
    const atomicCalls = attachAtomicPublisher(repo, drafts, atomicPublished)
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    const result = service.publishDraft(created.id, 'alice', { enable: true })
    expect(result.installationEnabled).toBe(true)
    expect(result.versionId).toBe('atomic-version-1')
    expect(atomicCalls).toHaveLength(1)
    expect(atomicCalls[0].draft.expectedRevision).toBe(created.revision)
    expect(atomicCalls[0].installation.enabled).toBe(true)
    expect(atomicPublished).toHaveLength(1)
    expect(published).toHaveLength(0)
  })

  it('does not leave package rows when the draft CAS is lost during publish', () => {
    const { repo, drafts, published } = repoFixture()
    const atomic = vi.fn((input: AtomicPublishInput) => {
      const row = drafts.get(input.draft.id)
      if (row) row.revision += 1
      throw Object.assign(new Error('Draft changed during publish'), { code: 'REVISION_CONFLICT' })
    })
    ;(repo as any).publishDraftTransaction = atomic
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    const expectedRevision = created.revision
    expect(() => service.publishDraft(created.id, 'alice', { enable: true })).toThrow(/Draft changed during publish/)
    expect(atomic).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ expectedRevision }) }))
    expect(published).toHaveLength(0)
  })

  it('does not create a second immutable version when publishing a published draft again', () => {
    const { repo, drafts, published } = repoFixture()
    const atomicPublished: AtomicPublishInput[] = []
    const atomicCalls = attachAtomicPublisher(repo, drafts, atomicPublished)
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    service.publishDraft(created.id, 'alice', { enable: false })
    expect(() => service.publishDraft(created.id, 'alice', { enable: true })).toThrow(/published|already|conflict/i)
    expect(atomicCalls).toHaveLength(1)
    expect(atomicPublished).toHaveLength(1)
    expect(published).toHaveLength(0)
  })

  it('previews without publishing or changing draft state and isolates owners', () => {
    const { repo, published, drafts } = repoFixture()
    const atomicPublish = vi.fn()
    ;(repo as any).publishDraftTransaction = atomicPublish
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    const before = { revision: drafts.get(created.id).revision, status: drafts.get(created.id).status }
    expect(service.previewDraft(created.id, 'alice').published).toBe(false)
    expect(atomicPublish).not.toHaveBeenCalled()
    expect(published).toHaveLength(0)
    expect(drafts.get(created.id)).toMatchObject(before)
    expect(() => service.getDraft(created.id, 'bob')).toThrow(/owner/)
    expect(() => service.discardDraft(created.id, 'bob')).toThrow(/owner/)
  })
})
