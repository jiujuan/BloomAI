import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DraftDto, SkillDraftContent } from './skill-runtime.types'
import { SkillCreatorWorkbench, canPublishCreatorDraft } from './SkillCreatorWorkbench'
import { SkillCreatorEditor } from './SkillCreatorEditor'
import { SkillCreatorPreview, sanitizeMarkdown } from './SkillCreatorPreview'
import { SkillCreatorValidationPanel } from './SkillCreatorValidationPanel'
import { getCreatorCapabilityRisk, getPublishedPackageId } from './SkillCreatorWorkbench'
import './skill-creator.e2e'

const content: SkillDraftContent = {
  name: 'Research Helper', slug: 'research-helper', version: '0.1.0', description: 'A safe helper', skillMd: '# Research Helper\n\nUse sources.',
  references: {}, assets: [], capabilities: [{ capability: 'web_search', scope: { allowedDomains: ['example.com'] } }], visibility: 'private',
}
const draft: DraftDto = { id: 'draft-1', content, revision: 2, status: 'draft' }

describe('Skills Creator workbench contract', () => {
  it('renders a controlled Creator entry when no draft is selected', () => {
    const markup = renderToStaticMarkup(<SkillCreatorWorkbench draftId={null} onCreated={() => {}} />)
    expect(markup).toContain('Skills Creator')
    expect(markup).toContain('新建 Draft')
    expect(markup).toContain('Publish feature flag')
  })

  it('exposes metadata, sanitized Markdown editing, validation and preview surfaces', () => {
    const editor = renderToStaticMarkup(<SkillCreatorEditor content={content} onChange={() => {}} />)
    const preview = renderToStaticMarkup(<SkillCreatorPreview content={content} preview={null} />)
    const validation = renderToStaticMarkup(<SkillCreatorValidationPanel validation={{ valid: false, errors: [{ path: 'skillMd', line: 2, message: 'missing instruction' }], warnings: [] }} />)
    expect(editor).toContain('aria-label="Skill name"')
    expect(editor).toContain('aria-label="SKILL.md"')
    expect(editor).toContain('受限文件资产')
    expect(preview).toContain('Research Helper')
    expect(preview).not.toContain('<script>')
    expect(validation).toContain('skillMd · line 2')
    expect(sanitizeMarkdown('<script>alert(1)</script><b>unsafe</b>')).toBe('alert(1)unsafe')
  })

  it('makes Package Runtime explicit and never offers Legacy Runtime', () => {
    const entry = renderToStaticMarkup(<SkillCreatorWorkbench draftId={null} onCreated={() => {}} />)
    const editor = renderToStaticMarkup(<SkillCreatorEditor content={content} onChange={() => {}} />)
    expect(entry).toContain('Package Runtime')
    expect(entry).not.toContain('Legacy Runtime')
    expect(editor).toContain('Package Runtime')
    expect(editor).not.toContain('Legacy Runtime')
  })

  it('marks high-risk capability requests with an approval warning', () => {
    const riskyContent: SkillDraftContent = { ...content, capabilities: [{ capability: 'command', scope: {} }] }
    const editor = renderToStaticMarkup(<SkillCreatorEditor content={riskyContent} onChange={() => {}} />)
    expect(getCreatorCapabilityRisk('command')).toMatchObject({ severity: 'high', approvalRequired: true })
    expect(editor).toContain('高风险')
    expect(editor).toContain('需要审批')
  })

  it('keeps publish navigation tied to the server Package relation', () => {
    expect(getPublishedPackageId({ packageId: 'package-1', versionId: 'version-1', installationId: 'installation-1' })).toBe('package-1')
    expect(getPublishedPackageId({ package: { id: 'package-2' }, version: { id: 'version-2' }, installation: { id: 'installation-2' } })).toBe('package-2')
    expect(getPublishedPackageId({ draftId: 'draft-1' })).toBeNull()
  })

  it('requires valid validation and preview evidence before publish', () => {
    expect(canPublishCreatorDraft(null, null)).toBe(false)
    expect(canPublishCreatorDraft({ valid: false, errors: [{ message: 'bad' }], warnings: [] }, null)).toBe(false)
    expect(canPublishCreatorDraft({ valid: true, errors: [], warnings: [] }, { validation: { valid: true, errors: [], warnings: [] }, draft })).toBe(true)
  })
})
