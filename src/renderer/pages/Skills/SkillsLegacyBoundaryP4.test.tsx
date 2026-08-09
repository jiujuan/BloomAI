import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeSkillsCenterState, SkillsCenterWorkbench, buildSkillRows } from './SkillsCenterWorkbench'
import type { SkillInstallation, SkillPackage, SkillRun } from './skill-runtime.types'

const root = resolve(process.cwd())
const productionFiles = [
  'src/renderer/pages/Skills/index.tsx',
  'src/renderer/pages/Skills/SkillsSidebar.tsx',
  'src/renderer/pages/Skills/SkillsCenterWorkbench.tsx',
  'src/renderer/pages/Skills/SkillOverviewPanel.tsx',
  'src/renderer/styles/global.css',
]

const packageItem: SkillPackage = {
  id: 'pkg-p4-001', name: 'Package-only Skill', description: 'Package description', sourceType: 'github', sourceUri: 'https://github.com/acme/package-only', sourceRef: 'abc123',
  createdAt: 1, updatedAt: 2, deletedAt: null, deleteReason: null,
}
const installation: SkillInstallation = {
  id: 'install-p4-001', packageId: 'pkg-p4-001', currentVersionId: 'version-p4-001', status: 'active', enabled: true, installedAt: 1, updatedAt: 2, revision: 3,
}
const run: SkillRun = {
  id: 'run-p4-001', skillVersionId: 'version-p4-001', status: 'completed', revision: 1, input: {}, output: {}, context: {}, surface: 'skills', sessionId: null, imageSessionId: null,
  waitingReason: null, cancelRequested: false, startedAt: 3, updatedAt: 4, finishedAt: 5, errorCode: null, errorMessage: null,
}

describe('SKL12-P4-001 frontend Legacy boundary', () => {
  it('removes the old renderer entry points and compatibility store', () => {
    expect(existsSync(resolve(root, 'src/renderer/pages/Skills/skills.store.ts'))).toBe(false)
    for (const file of productionFiles) {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(source).not.toMatch(/LegacySkillsMarket|SkillsMarket|Create Legacy Skill|legacySkills|legacyLabel|LEGACY_VIEW_ALIASES|Legacy Runtime|Legacy ·|Legacy Skills Market|skills-market/i)
    }
  })

  it('rejects removed Legacy route aliases', () => {
    expect(decodeSkillsCenterState('#skills/tab=installed').tab).toBeUndefined()
    expect(decodeSkillsCenterState('#skills/tab=available').tab).toBeUndefined()
    expect(decodeSkillsCenterState('#skills/tab=drafts').tab).toBeUndefined()
  })

  it('renders and projects Package Runtime rows only', () => {
    const rows = buildSkillRows([packageItem], [installation], [run])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('package')
    const markup = renderToStaticMarkup(<SkillsCenterWorkbench />)
    expect(markup).toContain('Package Runtime')
    expect(markup).not.toContain('Installed')
    expect(markup).not.toContain('Available / Import')
    expect(markup).not.toContain('Drafts')
    expect(markup).not.toContain('Legacy')
  })
})
