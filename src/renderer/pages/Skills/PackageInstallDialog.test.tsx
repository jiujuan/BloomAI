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
  it('validates and maps GitHub, local directory, ZIP and npx artifact sources', () => {
    expect(validatePackageSourceInput('github', { repositoryUrl: 'not-a-url', ref: 'main' })).toContain('请输入有效的 GitHub 仓库 URL。')
    expect(validatePackageSourceInput('local-directory', { directory: '  ' })).toContain('请输入本地目录路径。')
    expect(validatePackageSourceInput('zip', { artifactPath: 'demo.tar.gz' })).toContain('ZIP 产物必须使用 .zip 扩展名。')
    expect(validatePackageSourceInput('npx', { packageName: 'not valid', artifactPath: 'C:/tmp/demo.zip' })).toContain('请输入有效的 npx 包名。')

    expect(buildPackageSource('github', { repositoryUrl: 'https://github.com/acme/demo', ref: 'main' })).toEqual({ kind: 'github-archive', repositoryUrl: 'https://github.com/acme/demo', ref: 'main' })
    expect(buildPackageSource('local-directory', { directory: 'C:/skills/demo' })).toEqual({ kind: 'local-directory', directory: 'C:/skills/demo' })
    expect(buildPackageSource('zip', { artifactPath: 'C:/artifacts/demo.zip' })).toEqual({ kind: 'zip', zipPath: 'C:/artifacts/demo.zip' })
    expect(buildPackageSource('npx', { packageName: '@acme/demo', artifactPath: 'C:/artifacts/demo.zip' })).toEqual({ kind: 'zip', zipPath: 'C:/artifacts/demo.zip', metadata: { origin: 'npx-artifact' } })
    expect(buildPackageSource('npx', { packageName: 'demo', artifactPath: 'C:/artifacts/demo' })).toEqual({ kind: 'local-directory', directory: 'C:/artifacts/demo', metadata: { origin: 'npx-artifact' } })
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
    expect(markup).toContain('GitHub')
    expect(markup).toContain('本地目录')
    expect(markup).toContain('ZIP')
    expect(markup).toContain('npx 产物')
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

  it('does not label an inspection without an Import Review as validated', () => {
    const markup = renderToStaticMarkup(<PackageInstallDialog onClose={() => undefined} initialInspection={inspection} />)
    expect(markup).not.toContain('已验证')
  })
})
