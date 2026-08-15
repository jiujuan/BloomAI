import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadReviewService() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  const client = await import('../../db/client')
  await client.runMigrations()
  const module = await import('./package-install-review.service')
  return { client, ...module }
}

describe('PackageInstallReviewService security boundary', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-review-data-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('redacts secrets from inspection and decision payloads before persistence', async () => {
    const { PackageInstallReviewService } = await loadReviewService()
    const service = new PackageInstallReviewService()
    const review = service.create({
      source: { kind: 'local-directory', directory: dataDir },
      sourceFingerprint: 'a'.repeat(64),
      inspection: {
        summary: 'safe',
        token: 'do-not-persist',
        nested: { password: 'also-do-not-persist' },
      },
    })

    expect(review.inspection).toMatchObject({
      summary: 'safe',
      token: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    })

    const rejected = service.reject(review.id, 'reviewer-1', 'contains api_key=do-not-persist')
    expect(rejected.decision).toMatchObject({ action: 'reject', reason: expect.stringContaining('[REDACTED]') })
    expect(JSON.stringify(rejected.decision)).not.toContain('do-not-persist')
  })

  it('persists a deep package inspection without relaxing the global security payload limit', async () => {
    const { PackageInstallReviewService } = await loadReviewService()
    const service = new PackageInstallReviewService()
    const inspection = {
      package: {
        manifest: {
          requestedCapabilities: [{
            scope: {
              allowedModels: [{
                provider: {
                  name: {
                    value: 'agnes-image-2.1-flash',
                  },
                },
              }],
            },
          }],
        },
      },
    }

    const review = service.create({
      source: { kind: 'local-directory', directory: dataDir },
      sourceFingerprint: 'c'.repeat(64),
      inspection,
    })

    expect(review.inspection).toEqual(inspection)
    expect(service.get(review.id).inspection).toEqual(inspection)
  })
  it('persists an import inspection with more than the global array-item limit', async () => {
    const { PackageInstallReviewService } = await loadReviewService()
    const service = new PackageInstallReviewService()
    const packages = Array.from({ length: 101 }, (_, index) => ({ name: `skill-${index}` }))

    const review = service.create({
      source: { kind: 'local-directory', directory: dataDir },
      sourceFingerprint: 'd'.repeat(64),
      inspection: { packages },
      securityFindings: { diagnostics: packages },
    })

    expect(review.inspection).toEqual({ packages })
    expect(service.get(review.id).inspection).toEqual({ packages })
  })

  it('rejects an import inspection exceeding the import-review array-item limit', async () => {
    const { MAX_IMPORT_REVIEW_PAYLOAD_ARRAY_ITEMS } = await import('../../security/security-payload')
    const { PackageInstallReviewService } = await loadReviewService()
    const service = new PackageInstallReviewService()

    expect(() => service.create({
      source: { kind: 'local-directory', directory: dataDir },
      sourceFingerprint: 'e'.repeat(64),
      inspection: {
        packages: Array.from({ length: MAX_IMPORT_REVIEW_PAYLOAD_ARRAY_ITEMS + 1 }, (_, index) => ({ name: `skill-${index}` })),
      },
    })).toThrowError(expect.objectContaining({ code: 'PAYLOAD_ARRAY_LIMIT' }))
  })

  it('persists an install decision when the result reaches the payload depth limit', async () => {
    const { PackageInstallReviewService } = await loadReviewService()
    const service = new PackageInstallReviewService()
    const review = service.create({
      source: { kind: 'local-directory', directory: dataDir },
      sourceFingerprint: 'b'.repeat(64),
      inspection: { summary: 'safe' },
    })
    const result = {
      status: 'awaiting_permission_review',
      packages: [{
        manifest: {
          requestedCapabilities: [{
            scope: { allowedModels: ['agnes-image-2.1-flash'] },
          }],
        },
      }],
    }

    const installed = service.markInstalled(review.id, result)

    expect(installed.decision).toEqual({ action: 'install', result })
    expect(service.get(review.id).decision).toEqual({ action: 'install', result })
  })
})
