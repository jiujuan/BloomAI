import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import type { PackageInstallSource } from './package-installer'

export type PackageImportReviewStatus = 'pending' | 'approved' | 'rejected' | 'installed'

export type PackageImportReview = {
  id: string
  source: string
  sourceSha: string
  sourceRef: string | null
  inspection: Record<string, unknown>
  status: PackageImportReviewStatus
  reviewer: string | null
  decision: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

export class PackageInstallReviewError extends Error {
  readonly code: 'REVIEW_NOT_FOUND' | 'REVIEW_NOT_APPROVED' | 'REVIEW_REJECTED' | 'REVIEW_FINGERPRINT_MISMATCH'

  constructor(code: PackageInstallReviewError['code'], message: string) {
    super(message)
    this.name = 'PackageInstallReviewError'
    this.code = code
  }
}

export class PackageInstallReviewService {
  create(input: {
    source: PackageInstallSource
    sourceFingerprint: string
    inspection: Record<string, unknown>
  }): PackageImportReview {
    const row = skillPackageRepo.createImportReview({
      source: input.source.kind,
      sourceSha: input.sourceFingerprint,
      sourceRef: sourceRef(input.source),
      inspection: input.inspection,
      status: 'pending',
    })
    return mapReview(row)
  }

  get(id: string): PackageImportReview {
    const row = skillPackageRepo.getImportReview(id)
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }

  approve(id: string, reviewer: string): PackageImportReview {
    const review = this.get(id)
    if (review.status === 'rejected') throw new PackageInstallReviewError('REVIEW_REJECTED', 'Rejected import reviews cannot be approved')
    const row = skillPackageRepo.updateImportReview(id, { status: 'approved', reviewer, decision: JSON.stringify({ action: 'approve' }) })
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }

  reject(id: string, reviewer: string, reason?: string): PackageImportReview {
    const review = this.get(id)
    if (review.status === 'installed') throw new PackageInstallReviewError('REVIEW_REJECTED', 'Installed import reviews cannot be rejected')
    const row = skillPackageRepo.updateImportReview(id, {
      status: 'rejected',
      reviewer,
      decision: JSON.stringify({ action: 'reject', reason: reason ?? null }),
    })
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }

  assertInstallable(id: string, sourceFingerprint: string, confirm: boolean): PackageImportReview {
    const review = this.get(id)
    if (!confirm) throw new PackageInstallReviewError('REVIEW_NOT_APPROVED', 'Package install requires explicit confirmation')
    if (review.sourceSha !== sourceFingerprint) throw new PackageInstallReviewError('REVIEW_FINGERPRINT_MISMATCH', 'Package source fingerprint changed since inspection')
    if (review.status === 'rejected') throw new PackageInstallReviewError('REVIEW_REJECTED', 'Package import review was rejected')
    if (review.status !== 'pending' && review.status !== 'approved' && review.status !== 'installed') {
      throw new PackageInstallReviewError('REVIEW_NOT_APPROVED', 'Package import review is not installable')
    }
    return review
  }

  markInstalled(id: string, result: Record<string, unknown>): PackageImportReview {
    const row = skillPackageRepo.updateImportReview(id, { status: 'installed', decision: JSON.stringify({ action: 'install', result }) })
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }
}

export const packageInstallReviewService = new PackageInstallReviewService()

function mapReview(row: any): PackageImportReview {
  return {
    id: row.id,
    source: row.source,
    sourceSha: row.source_sha,
    sourceRef: row.source_ref ?? null,
    inspection: parseJsonObject(row.inspection_json),
    status: row.status as PackageImportReviewStatus,
    reviewer: row.reviewer ?? null,
    decision: row.decision ? parseJsonObject(row.decision) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sourceRef(source: PackageInstallSource): string | null {
  if (source.kind === 'local-directory') return source.directory
  if (source.kind === 'zip') return source.zipPath
  return `${source.repositoryUrl}#${source.ref}${source.subdirectory ? `/${source.subdirectory}` : ''}`
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
