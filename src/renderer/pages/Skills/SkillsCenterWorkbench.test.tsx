import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import './skills-center.e2e'
import type { SkillPackage, SkillRun, SkillInstallation } from './skill-runtime.types'
import { SkillsCenterWorkbench, buildSkillRows, filterSkillRows, encodeSkillsCenterState, decodeSkillsCenterState, getVisibleSkillsRuntimeError, hasRuntimeManagementCapability } from './SkillsCenterWorkbench'
import { normalizeSkillsView } from './SkillsSidebar'

const packageItem: SkillPackage = {
  id: 'pkg-1', name: 'Research Package', description: 'Package description', sourceType: 'github', sourceUri: 'https://github.com/acme/research', sourceRef: 'abc123',
  createdAt: 1, updatedAt: 2, deletedAt: null, deleteReason: null,
}
const installation: SkillInstallation = {
  id: 'install-1', packageId: 'pkg-1', currentVersionId: 'version-1', status: 'installed', enabled: 1, installedAt: 1, updatedAt: 2, revision: 3,
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
    expect(markup).not.toContain('导入 Package')
    expect(markup).not.toContain('打开 Creator')
    expect(markup).not.toContain('Skills Creator')
    expect(markup).toContain('aria-label="搜索 Skills"')
  })

  it('only exposes a scoped runtime error to its active page and keeps import errors local', () => {
    const message = 'Skill Runtime feature is disabled: importEnabled'
    expect(getVisibleSkillsRuntimeError(message, 'import', 'center')).toBeNull()
    expect(getVisibleSkillsRuntimeError(message, 'import', 'runs')).toBeNull()
    expect(getVisibleSkillsRuntimeError(message, 'import', 'artifacts')).toBeNull()
    expect(getVisibleSkillsRuntimeError(message, 'import', 'settings')).toBeNull()
    expect(getVisibleSkillsRuntimeError(message, 'import', 'import')).toBeNull()
    expect(getVisibleSkillsRuntimeError(message, 'center', 'center')).toBe(message)
    expect(getVisibleSkillsRuntimeError(message, 'center', 'runs')).toBeNull()

    const startFailure = 'Installed and enabled Package Skill was not found'
    expect(getVisibleSkillsRuntimeError(startFailure, 'runs', 'center')).toBeNull()
    expect(getVisibleSkillsRuntimeError(startFailure, 'runs', 'runs')).toBe(startFailure)
  })

  it('projects Package Runtime rows and filters source/runtime/status', () => {
    const rows = buildSkillRows([packageItem], [installation], [run])
    expect(rows.map((row) => row.kind)).toEqual(['package'])
    expect(rows[0].sourceLabel).toContain('Package')
    expect(rows[0]).toMatchObject({ enabled: true, statusLabel: '已启用' })
    expect(filterSkillRows(rows, { query: '', source: 'package', runtime: 'package', status: 'all' }).map((row) => row.id)).toEqual(['pkg-1'])
    expect(filterSkillRows(rows, { query: '', source: 'all', runtime: 'all', status: 'disabled' })).toEqual([])
  })

  it('removes runtime status labels from the Skills page chrome', () => {
    const markup = renderToStaticMarkup(<SkillsCenterWorkbench />)
    expect(markup).not.toContain('Runtime Healthy')
    expect(markup).not.toContain('Runtime Checking')
    expect(markup).not.toContain('Runtime Ready')
    expect(markup).not.toContain('Runtime Disabled')
    expect(markup).not.toContain('Runtime Degraded')
    expect(markup).not.toContain('· Worker')
    expect(hasRuntimeManagementCapability({ canManage: false })).toBe(false)
    expect(hasRuntimeManagementCapability({ canManage: true })).toBe(true)
  })

  it('serializes only non-secret selected resource state and downgrades legacy run-detail hashes', () => {
    const encoded = encodeSkillsCenterState({ tab: 'runs', selectedPackageId: 'pkg-1' })
    expect(encoded).toBe('#skills/tab=runs&package=pkg-1')
    expect(decodeSkillsCenterState(encoded)).toEqual({ tab: 'runs', selectedPackageId: 'pkg-1', draftId: undefined })
    const creatorEncoded = encodeSkillsCenterState({ tab: 'creator', draftId: 'draft-1' })
    expect(creatorEncoded).toBe('#skills/tab=creator&draft=draft-1')
    expect(decodeSkillsCenterState(creatorEncoded)).toEqual({ tab: 'creator', selectedPackageId: undefined, draftId: 'draft-1' })
    expect(normalizeSkillsView('creator')).toBe('center')
    expect(decodeSkillsCenterState('#skills/tab=permissions&package=pkg-1')).toMatchObject({ tab: 'detail', selectedPackageId: 'pkg-1' })

    const legacyRunRoute = decodeSkillsCenterState('#skills/tab=run-detail&run=run-1')
    expect(legacyRunRoute).toEqual({ tab: 'runs', selectedPackageId: undefined, draftId: undefined })
    expect(legacyRunRoute).not.toHaveProperty('run')
    expect(legacyRunRoute).not.toHaveProperty('selectedRunId')
    expect(encodeSkillsCenterState({ tab: 'runs' })).toBe('#skills/tab=runs')
    expect(encoded).not.toContain('token')
    expect(encoded).not.toContain('secret')
  })
})
