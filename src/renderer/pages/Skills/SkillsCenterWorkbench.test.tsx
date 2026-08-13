import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import './skills-center.e2e'
import type { SkillPackage, SkillRun, SkillInstallation, SkillRuntimeCapabilities } from './skill-runtime.types'
import { SkillsCenterWorkbench, buildSkillRows, filterSkillRows, encodeSkillsCenterState, decodeSkillsCenterState, getRuntimeStatusLabel, hasRuntimeManagementCapability } from './SkillsCenterWorkbench'

const packageItem: SkillPackage = {
  id: 'pkg-1', name: 'Research Package', description: 'Package description', sourceType: 'github', sourceUri: 'https://github.com/acme/research', sourceRef: 'abc123',
  createdAt: 1, updatedAt: 2, deletedAt: null, deleteReason: null,
}
const installation: SkillInstallation = {
  id: 'install-1', packageId: 'pkg-1', currentVersionId: 'version-1', status: 'active', enabled: true, installedAt: 1, updatedAt: 2, revision: 3,
}
const run: SkillRun = {
  id: 'run-1', skillVersionId: 'version-1', status: 'completed', revision: 1, input: {}, output: {}, context: {}, surface: 'skills', sessionId: null, imageSessionId: null,
  waitingReason: null, cancelRequested: false, startedAt: 3, updatedAt: 4, finishedAt: 5, errorCode: null, errorMessage: null,
}
describe('Skills Center workbench contract', () => {
  it('renders the single-page navigation and safety controls', () => {
    const markup = renderToStaticMarkup(<SkillsCenterWorkbench />)
    expect(markup).toContain('Skills Center')
    expect(markup).toContain('导入 Skill')
    expect(markup).toContain('Runs')
    expect(markup).toContain('导入 Package')
    expect(markup).toContain('打开 Creator')
    expect(markup).toContain('aria-label="搜索 Skills"')
  })

  it('projects Package Runtime rows and filters source/runtime/status', () => {
    const rows = buildSkillRows([packageItem], [installation], [run])
    expect(rows.map((row) => row.kind)).toEqual(['package'])
    expect(rows[0].sourceLabel).toContain('Package')
    expect(filterSkillRows(rows, { query: '', source: 'package', runtime: 'package', status: 'all' }).map((row) => row.id)).toEqual(['pkg-1'])
    expect(filterSkillRows(rows, { query: '', source: 'all', runtime: 'all', status: 'disabled' })).toEqual([])
  })

  it('projects runtime state and gates diagnostics on the management capability', () => {
    expect(getRuntimeStatusLabel(null)).toBe('Runtime Checking')
    expect(getRuntimeStatusLabel({ operationalStatus: 'disabled' })).toBe('Runtime Disabled')
    expect(getRuntimeStatusLabel({ operationalStatus: 'degraded' })).toBe('Runtime Degraded')
    expect(getRuntimeStatusLabel({ operationalStatus: 'ready' })).toBe('Runtime Ready')
    expect(hasRuntimeManagementCapability({ canManage: false })).toBe(false)
    expect(hasRuntimeManagementCapability({ canManage: true })).toBe(true)
  })

  it('serializes only non-secret selected resource state for refresh recovery', () => {
    const encoded = encodeSkillsCenterState({ tab: 'runs', selectedPackageId: 'pkg-1' })
    expect(encoded).toBe('#skills/tab=runs&package=pkg-1')
    expect(decodeSkillsCenterState(encoded)).toEqual({ tab: 'runs', selectedPackageId: 'pkg-1' })
    const creatorEncoded = encodeSkillsCenterState({ tab: 'creator', draftId: 'draft-1' })
    expect(creatorEncoded).toBe('#skills/tab=creator&draft=draft-1')
    expect(decodeSkillsCenterState(creatorEncoded)).toEqual({ tab: 'creator', draftId: 'draft-1' })
    expect(decodeSkillsCenterState('#skills/tab=permissions&package=pkg-1')).toMatchObject({ tab: 'detail', selectedPackageId: 'pkg-1' })
    expect(decodeSkillsCenterState('#skills/tab=run-detail&run=run-1')).toMatchObject({ tab: 'runs' })
    expect(decodeSkillsCenterState('#skills/tab=run-detail&run=run-1')).not.toHaveProperty('selectedRunId')
    expect(encoded).not.toContain('token')
    expect(encoded).not.toContain('secret')
  })
})
