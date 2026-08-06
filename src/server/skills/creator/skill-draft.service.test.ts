import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSkillDraftService, type SkillDraftRepository } from './skill-draft.service'

type Draft = any

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
      if (!row || row.ownerId !== input.ownerId || row.revision !== input.expectedRevision) return undefined
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
      if (!row) return undefined
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
      const result = { package: { id: 'package-1' }, version: { id: 'version-1', manifest_hash: input.version.manifestHash }, snapshot: { id: 'snapshot-1', snapshot_hash: input.snapshot.snapshotHash }, installation: { id: 'installation-1', enabled: 0 } }
      published.push(input)
      return result
    },
  }
  return { repo, drafts, published }
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

  it('validates markdown through the canonical manifest pipeline and reports unsupported capabilities', () => {
    const { repo } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: { ...validContent, skillMd: '---\ncapabilities:\n  shell.execute: true\n---\n# Unsafe' } })
    const result = service.validateDraft(created.id, 'alice')
    expect(result.valid).toBe(false)
    expect(result.errors.some((error: any) => error.code === 'UNSUPPORTED_DECLARATION')).toBe(true)
    expect(result.securityFindings).toContain('capability:shell.execute')
  })

  it('publishes an immutable version and keeps later draft edits separate', () => {
    const { repo, published } = repoFixture()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-draft-service-'))
    const service = createSkillDraftService({ repo, packageDataRoot: root })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    const result = service.publishDraft(created.id, 'alice', { enable: false })
    expect(result.versionId).toBe('version-1')
    expect(result.installationEnabled).toBe(false)
    expect(published[0].snapshot.filesManifest['SKILL.md']).toBeTruthy()
    const updated = service.updateDraft(created.id, 'alice', { description: 'new draft' }, 1)
    expect(updated.content.description).toBe('new draft')
    expect(published[0].version.manifest.description).toBe('Writes clearly')
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('previews without publishing and isolates owners', () => {
    const { repo, published } = repoFixture()
    const service = createSkillDraftService({ repo })
    const created = service.createDraft({ ownerId: 'alice', content: validContent })
    expect(service.previewDraft(created.id, 'alice').published).toBe(false)
    expect(published).toHaveLength(0)
    expect(() => service.getDraft(created.id, 'bob')).toThrow(/owner/)
    expect(() => service.discardDraft(created.id, 'bob')).toThrow(/owner/)
  })
})
