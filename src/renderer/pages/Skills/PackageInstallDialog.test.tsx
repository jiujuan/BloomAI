import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  PackageInstallDialog,
  buildPackageSource,
  canInstallImportReview,
  getImportReviewTone,
  validatePackageSourceInput,
} from './PackageInstallDialog'
import type { PackageImportReview, PackageInspectionResult } from './skill-runtime.types'

const inspection: PackageInspectionResult = {
  reviewId: 'review-1',
  sourceFingerprint: 'a'.repeat(64),
  resolvedCommitSha: 'commit-1',
  packages: [{
    sourceType: 'github',
    relativeSkillPath: 'skills/demo',
    manifestHash: 'manifest-1',
    sourceFingerprint: 'a'.repeat(64),
    diagnostics: [{ code: 'capability-review', severity: 'warning', message: '需要审批 command capability' }],
    importReviewRequired: true,
    manifest: {
      name: 'Demo Skill', description: 'Demo description', runtime: 'package-runtime', entryPath: 'SKILL.md', compatible: true,
      requestedCapabilities: [{ capability: 'command', scope: { allowedRoots: ['workspace'] } }], recommendedSurface: 'skills',
      outputArtifactTypes: ['markdown'], references: [], assets: [], scripts: [], unsupported: [], unknownFrontmatter: {}, files: [],
    },
    sourceSnapshot: { sourceSha256: 'source-1', sourceCommit: 'commit-1', sourceRef: 'main', files: [] },
  }],
}

const review = (status: PackageImportReview['status']): PackageImportReview => ({
  id: 'review-1', source: 'github-archive', sourceSha: 'a'.repeat(64), sourceRef: 'main', inspection: {}, securityFindings: {},
  status, reviewer: null, decision: null, createdAt: 1, updatedAt: 2,
})

describe('Package import workflow contract', () => {
  it('validates and maps GitHub, local directory and ZIP sources', () => {
    expect(validatePackageSourceInput('github', { repositoryUrl: 'not-a-url', ref: 'main' })).toContain('请输入有效的 GitHub 仓库 URL。')
    for (const repositoryUrl of ['https://github.com/acme/demo', 'https://github.com/acme/demo.git']) {
      expect(validatePackageSourceInput('github', { repositoryUrl, ref: 'main' })).toEqual([])
    }
    for (const repositoryUrl of [
      'http://github.com/acme/demo',
      'https://www.github.com/acme/demo',
      'https://github.com/acme/demo/issues',
      'https://github.com/acme/demo?x=1',
      'https://github.com/acme/demo#readme',
    ]) {
      expect(validatePackageSourceInput('github', { repositoryUrl, ref: 'main' })).toContain('请输入有效的 GitHub 仓库 URL。')
    }
    expect(validatePackageSourceInput('local-directory', { directory: '  ' })).toContain('请输入本地目录路径。')
    expect(validatePackageSourceInput('zip', {})).toContain('请选择本地 ZIP 文件。')
    expect(validatePackageSourceInput('zip', { zipPath: 'C:/downloads/skills.txt' })).toContain('ZIP 文件必须使用 .zip 扩展名。')
    expect(validatePackageSourceInput('zip', { zipPath: 'C:/downloads/skills.zip' })).toEqual([])

    expect(buildPackageSource('github', { repositoryUrl: 'https://github.com/acme/demo', ref: 'main' })).toEqual({ kind: 'github-archive', repositoryUrl: 'https://github.com/acme/demo', ref: 'main' })
    expect(buildPackageSource('local-directory', { directory: 'C:/skills/demo' })).toEqual({ kind: 'local-directory', directory: 'C:/skills/demo' })
    expect(buildPackageSource('zip', { zipPath: 'C:/downloads/skills.zip', subdirectory: 'skills' })).toEqual({ kind: 'zip', zipPath: 'C:/downloads/skills.zip', subdirectory: 'skills' })
  })

  it('renders exactly three source tabs and a page-mode import shell', () => {
    const dialogMarkup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} />)
    expect(dialogMarkup).toContain('role="dialog"')
    expect(dialogMarkup).toContain('GitHub Archive')
    expect(dialogMarkup).toContain('本地目录')
    expect(dialogMarkup).toContain('导入skills zip')
    expect(dialogMarkup).not.toContain('npx skills 产物')

    const pageMarkup = renderToStaticMarkup(<PackageInstallDialog mode="page" onClose={() => undefined} />)
    const tabs = pageMarkup.match(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g) ?? []
    const tabLabels = tabs.map((tab) => tab.match(/<strong>([^<]+)<\/strong>/)?.[1])

    expect(tabs).toHaveLength(3)
    expect(tabLabels).toEqual(['GitHub Archive', '本地目录', '导入skills zip'])
    expect(tabs[0]).toContain('aria-controls="import-source-panel-github"')
    expect(tabs[1]).toContain('aria-controls="import-source-panel-local-directory"')
    expect(tabs[2]).toContain('aria-controls="import-source-panel-zip"')
    expect(pageMarkup).toContain('role="tablist" aria-label="Skill 导入方式"')
    expect(pageMarkup).toContain('导入真实 SKILL.md 目录')
    expect(pageMarkup).toContain('选择 ZIP 压缩包并扫描其中的 Skills')
    expect(pageMarkup).toContain('class="skills-import-page"')
    expect(pageMarkup).toContain('id="package-import-page-title"')
    expect(pageMarkup).not.toContain('skills-import-page-card-head')
    expect(pageMarkup).toContain('skills-eyebrow">Step 1</div><h3 id="import-source-title">选择导入方式</h3>')
    expect(pageMarkup).not.toContain('skills-modal-backdrop')
    expect(pageMarkup).not.toContain('role="dialog"')
    expect(pageMarkup).not.toContain('npx skills 产物')
    expect(pageMarkup).toContain('把本地目录、GitHub Archive 或 Skills ZIP 转换为可审核的 Skill Version。')
  })

  it('defines a ZIP source form with native selection and ZIP-only drag-and-drop guidance', () => {
    const source = readFileSync(new URL('./PackageInstallDialog.tsx', import.meta.url), 'utf8')

    expect(source).toContain('选择 ZIP 文件')
    expect(source).toContain('ZIP 文件路径')
    expect(source).toContain('扫描其中包含 SKILL.md 的目录')
    expect(source).toContain('platform.selectZipFile()')
    expect(source).toContain('请拖入一个 .zip 文件，或使用“选择 ZIP 文件”按钮。')
    expect(source).not.toContain('npx skills add')
  })

  it('keeps scan errors in the import actions area beside the scan button', () => {
    const source = readFileSync(new URL('./PackageInstallDialog.tsx', import.meta.url), 'utf8')
    const actionsStart = source.indexOf('<div className="skills-import-actions">')
    const actionsEnd = source.indexOf('</div>', actionsStart)
    const workflowEnd = source.indexOf('{error && <div className="skills-message error" role="alert">')

    expect(actionsStart).toBeGreaterThanOrEqual(0)
    expect(source.slice(actionsStart, actionsEnd)).toContain('skills-import-action-error')
    expect(workflowEnd).toBe(-1)
  })

  it('uses semantic review tones and only allows approved or installed reviews to install', () => {
    expect(getImportReviewTone('scanning')).toBe('info')
    expect(getImportReviewTone('warning')).toBe('warning')
    expect(getImportReviewTone('rejected')).toBe('danger')
    expect(getImportReviewTone('approved')).toBe('success')
    expect(canInstallImportReview(review('approved'))).toBe(true)
    expect(canInstallImportReview(review('installed'))).toBe(true)
    expect(canInstallImportReview(review('warning'))).toBe(false)
    expect(canInstallImportReview(review('rejected'))).toBe(false)
  })

  it('renders staged source, inspection, review and audit context controls', () => {
    const markup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} />)
    expect(markup).toContain('选择来源')
    expect(markup).toContain('解析和扫描')
    expect(markup).toContain('确认安装')
    expect(markup).toContain('GitHub Archive')
    expect(markup).toContain('本地目录')
    expect(markup).toContain('导入skills zip')
    expect(markup).not.toContain('npx skills 产物')
    expect(markup).toContain('Capability')
    expect(markup).toContain('审计')
    expect(markup).toContain('Rejected 后不可安装')
  })

  it('renders inspection diagnostics, capability risks and review status', () => {
    const markup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} initialInspection={inspection} initialReview={review('warning')} />)
    expect(markup).toContain('Demo Skill')
    expect(markup).toContain('需要审批 command capability')
    expect(markup).toContain('warning')
    expect(markup).toContain('command')
    expect(markup).toContain('source fingerprint')
  })

  it('shows ignored archive paths once in the active review panel', () => {
    const ignoredInspection: PackageInspectionResult = {
      ...inspection,
      packages: inspection.packages.map((item) => ({
        ...item,
        sourceSnapshot: { ...item.sourceSnapshot, ignoredPaths: ['skills-main/AGENTS.md'] },
      })),
    }
    const markup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} initialInspection={ignoredInspection} />)

    expect(markup).toContain('已安全忽略 1 个不参与 Skill 导入的来源文件：')
    expect((markup.match(/skills-main\/AGENTS\.md/g) ?? [])).toHaveLength(1)
  })

  it('does not label an inspection without an Import Review as validated', () => {
    const markup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} initialInspection={inspection} />)
    expect(markup).not.toContain('已验证')
  })
})
