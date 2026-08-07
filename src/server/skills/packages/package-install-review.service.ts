import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import type { PackageInstallSource } from './package-installer'
import { sanitizeSecurityPayload, validateExternalSource } from '../security/skill-security-checklist'

export type PackageImportReviewStatus = 'scanning' | 'validated' | 'warning' | 'pending' | 'approved' | 'rejected' | 'installed'

export type PackageImportReview = {
  id: string
  source: string
  sourceSha: string
  sourceRef: string | null
  inspection: Record<string, unknown>
  securityFindings: Record<string, unknown>
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
    securityFindings?: Record<string, unknown>
    status?: Extract<PackageImportReviewStatus, 'scanning' | 'validated' | 'warning' | 'pending'>
  }): PackageImportReview {
    const source = validateExternalSource(input.source) as PackageInstallSource
    const inspection = sanitizeReviewObject(input.inspection, 'inspection')
    const row = skillPackageRepo.createImportReview({
      source: source.kind,
      sourceSha: input.sourceFingerprint,
      sourceRef: sourceRef(source),
      inspection,
      securityFindings: sanitizeReviewObject(input.securityFindings ?? {}, 'security findings'),
      status: input.status ?? 'pending',
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
    const row = skillPackageRepo.updateImportReview(id, { status: 'approved', reviewer: sanitizeReviewString(reviewer, 'reviewer'), decision: JSON.stringify(sanitizeReviewObject({ action: 'approve' }, 'decision')) })
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }

  reject(id: string, reviewer: string, reason?: string): PackageImportReview {
    const review = this.get(id)
    if (review.status === 'installed') throw new PackageInstallReviewError('REVIEW_REJECTED', 'Installed import reviews cannot be rejected')
    const row = skillPackageRepo.updateImportReview(id, {
      status: 'rejected',
      reviewer: sanitizeReviewString(reviewer, 'reviewer'),
      decision: JSON.stringify(sanitizeReviewObject({ action: 'reject', reason: reason ?? null }, 'decision')),
    })
    if (!row) throw new PackageInstallReviewError('REVIEW_NOT_FOUND', `Import review not found: ${id}`)
    return mapReview(row)
  }

  assertInstallable(id: string, sourceFingerprint: string, confirm: boolean): PackageImportReview {
    const review = this.get(id)
    if (!confirm) throw new PackageInstallReviewError('REVIEW_NOT_APPROVED', 'Package install requires explicit confirmation')
    if (review.sourceSha !== sourceFingerprint) throw new PackageInstallReviewError('REVIEW_FINGERPRINT_MISMATCH', 'Package source fingerprint changed since inspection')
    if (review.status === 'rejected') throw new PackageInstallReviewError('REVIEW_REJECTED', 'Package import review was rejected')
    if (!['scanning', 'validated', 'warning', 'pending', 'approved', 'installed'].includes(review.status)) {
      throw new PackageInstallReviewError('REVIEW_NOT_APPROVED', 'Package import review is not installable')
    }
    return review
  }

  markInstalled(id: string, result: Record<string, unknown>): PackageImportReview {
    const decision = sanitizeReviewDecision({ action: 'install', result }, 'decision')
    const row = skillPackageRepo.updateImportReview(id, { status: 'installed', decision: JSON.stringify(decision) })
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
    securityFindings: parseJsonObject(row.security_findings_json ?? '{}'),
    status: row.status as PackageImportReviewStatus,
    reviewer: row.reviewer ?? null,
    decision: row.decision ? parseJsonObject(row.decision, 'decision') : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sourceRef(source: PackageInstallSource): string | null {
  if (source.kind === 'local-directory') return source.directory
  if (source.kind === 'zip') return source.zipPath
  return `${source.repositoryUrl}#${source.ref}${source.subdirectory ? `/${source.subdirectory}` : ''}`
}

function parseJsonObject(value: string, fieldName = 'stored review payload'): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return fieldName === 'decision'
      ? sanitizeReviewDecision(parsed as Record<string, unknown>, fieldName)
      : sanitizeReviewObject(parsed as Record<string, unknown>, fieldName)
  } catch {
    return {}
  }
}

function sanitizeReviewDecision(value: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const { result, ...metadata } = value
  const sanitizedMetadata = sanitizeReviewObject(metadata, fieldName)
  if (result === undefined) return sanitizedMetadata
  const sanitizedResult = sanitizeReviewObject(result as Record<string, unknown>, `${fieldName}.result`)
  return { ...sanitizedMetadata, result: sanitizedResult }
}

function sanitizeReviewObject(value: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const sanitized = sanitizeSecurityPayload(value)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) throw new Error(`${fieldName} must be a JSON object`)
  return sanitized as Record<string, unknown>
}

function sanitizeReviewString(value: string, fieldName: string): string {
  const sanitized = sanitizeSecurityPayload(value, { maxStringLength: 256 })
  if (typeof sanitized !== 'string') throw new Error(`${fieldName} must be a string`)
  return sanitized
}
