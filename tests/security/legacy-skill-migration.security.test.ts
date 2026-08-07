import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpApiManualReviewReport, createJsFunctionCriticalBlockedReport } from '../../src/server/skills/migration/manual-review-report'
import { createMigrationPreviewService } from '../../src/server/skills/migration/migration-preview.service'
import { MIGRATION_ERROR_CODES, MigrationError } from '../../src/server/skills/migration/migration-errors'
import { redactSecrets } from '../../src/server/skills/migration/secret-redactor'
import { normalizeLegacySource } from '../../src/server/skills/migration/source-normalizer'

function httpSource(url: string, extra: Record<string, unknown> = {}) {
  return normalizeLegacySource({
    legacySkillId: 'security-http-fixture',
    type: 'http-api',
    source: { url, method: 'POST', ...extra },
  })
}

function reportFor(url: string, extra: Record<string, unknown> = {}) {
  return createHttpApiManualReviewReport(httpSource(url, extra))
}

function riskCodes(url: string, extra: Record<string, unknown> = {}) {
  return reportFor(url, extra).urlRisks.map((risk) => risk.code)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Legacy Skills migration security boundary', () => {
  it.each([
    ['http://localhost/internal', 'LOOPBACK_HOST'],
    ['http://service.localhost/internal', 'LOOPBACK_HOST'],
    ['http://127.0.0.1:8080/internal', 'LOOPBACK_HOST'],
    ['http://0.0.0.0/internal', 'LOOPBACK_HOST'],
    ['http://10.0.0.8/internal', 'PRIVATE_OR_METADATA_HOST'],
    ['http://172.16.10.4/internal', 'PRIVATE_OR_METADATA_HOST'],
    ['http://192.168.1.4/internal', 'PRIVATE_OR_METADATA_HOST'],
    ['http://169.254.169.254/latest/meta-data', 'PRIVATE_OR_METADATA_HOST'],
    ['http://metadata.google.internal/computeMetadata/v1', 'PRIVATE_OR_METADATA_HOST'],
    ['http://[::1]/internal', 'LOOPBACK_HOST'],
    ['http://[::ffff:127.0.0.1]/internal', 'PRIVATE_OR_METADATA_HOST'],
  ])('marks SSRF target %s as high-risk or critical', (url, expectedCode) => {
    expect(riskCodes(url)).toContain(expectedCode)
    expect(reportFor(url).riskLevel).toBe('critical')
  })

  it.each([
    'file:///etc/passwd',
    'data:text/plain,secret',
    'javascript:alert(1)',
    'gopher://127.0.0.1:6379/_PING',
    'FiLe:///etc/passwd',
  ])('does not treat unsafe or deceptive scheme %s as an executable endpoint', (url) => {
    const report = reportFor(url)
    expect(report.urlRisks.map((risk) => risk.code)).toContain('UNSAFE_SCHEME')
    expect(report.sideEffects.network).toBe(false)
  })

  it('flags URL credentials, sensitive query keys, redirects, and DNS rebinding', () => {
    const report = reportFor('https://user:password@api.example.test/items?access_token=secret&sig=abc', {
      followRedirects: true,
      maxRedirects: 3,
      headers: { Authorization: 'Bearer real-token', Cookie: 'sid=real-cookie', 'x-api-key': 'real-api-key' },
      query: { credential: 'real-credential' },
    })
    expect(report.urlRisks.map((risk) => risk.code)).toEqual(expect.arrayContaining([
      'URL_CREDENTIALS',
      'SENSITIVE_QUERY',
      'REDIRECT_POLICY',
      'DNS_REBINDING_RISK',
    ]))
    expect(report.auth).toMatchObject({ present: true })
    expect(report.request.queryKeys).toEqual(expect.arrayContaining(['access_token', 'sig', 'credential']))
  })

  it('redacts authentication and high-entropy values from reports and leaves only safe summaries', () => {
    const secrets = {
      headers: {
        Authorization: 'Bearer real-token-value',
        Cookie: 'session=real-cookie-value',
        'x-api-key': 'real-api-key-value',
      },
      password: 'real-password-value',
      body: { apiKey: 'real-body-api-key', text: 'access_token=real-query-token' },
      log: 'Bearer real-log-token',
      env: 'superSecretEnvironmentValue-9cKp3Qa8Lm1N',
    }
    const report = reportFor('https://api.example.test/items?token=real-url-token', secrets)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('Bearer real-token-value')
    expect(serialized).not.toContain('session=real-cookie-value')
    expect(serialized).not.toContain('real-api-key-value')
    expect(serialized).not.toContain('real-password-value')
    expect(serialized).not.toContain('real-body-api-key')
    expect(serialized).not.toContain('real-query-token')
    expect(serialized).not.toContain('Bearer real-log-token')
    expect(serialized).not.toContain('superSecretEnvironmentValue-9cKp3Qa8Lm1N')
    expect(serialized).not.toContain('real-url-token')
    expect(report.request.headerNames).toEqual(['Authorization', 'Cookie', 'x-api-key'])
    expect(report.auth).toMatchObject({ present: true })
    expect(report.redaction.redactedCount).toBeGreaterThan(0)
    expect(serialized).toContain('[REDACTED]')
  })

  it('fails closed for cyclic, over-deep, over-wide, and oversized migration source input', () => {
    const cyclic: Record<string, unknown> = { legacySkillId: 'cyclic', type: 'prompt-template', source: 'x' }
    cyclic.metadata = cyclic
    expect(() => normalizeLegacySource(cyclic)).toThrow(MigrationError)

    let deep: Record<string, unknown> = {}
    const deepRoot = deep
    for (let index = 0; index < 40; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    expect(() => normalizeLegacySource({ legacySkillId: 'deep', type: 'prompt-template', source: 'x', metadata: deepRoot })).toThrow(MigrationError)

    expect(() => normalizeLegacySource({
      legacySkillId: 'wide',
      type: 'prompt-template',
      source: 'x',
      metadata: Object.fromEntries(Array.from({ length: 2_001 }, (_, index) => [`key-${index}`, index])),
    })).toThrow(MigrationError)

    expect(() => normalizeLegacySource({
      legacySkillId: 'large',
      type: 'prompt-template',
      source: 'x'.repeat(600_000),
    })).toThrow(MigrationError)
  })

  it('limits manual-review shape traversal and array disclosure', () => {
    const body: Record<string, unknown> = {}
    let cursor = body
    for (let index = 0; index < 20; index += 1) {
      cursor.child = {}
      cursor = cursor.child as Record<string, unknown>
    }
    cursor.secret = 'must-not-appear'
    const report = reportFor('https://api.example.test/items', { body: { items: Array.from({ length: 200 }, () => ({ secret: 'must-not-appear' })), nested: body } })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('must-not-appear')
    expect(JSON.stringify(report.request.bodyShape)).toContain('depth-limited')
    expect(JSON.stringify(report.request.bodyShape)).toContain('truncated')
  })

  it('never executes arbitrary JavaScript, creates a VM, imports modules, writes probes, or launches a child process', () => {
    const probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-migration-security-')), 'executed.txt')
    const js = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(probe)}, 'executed'); eval('process.exit(1)'); new Function('return 1')()`
    const source = normalizeLegacySource({ legacySkillId: 'js-probe', type: 'js-function', source: js })
    const vmRun = vi.spyOn(process, 'nextTick')
    const report = createJsFunctionCriticalBlockedReport(source)
    expect(report.decision).toBe('critical_blocked')
    expect(report.sideEffects).toMatchObject({ execution: false, vm: false, eval: false, functionConstructor: false, childProcess: false, dynamicImport: false, network: false })
    expect(fs.existsSync(probe)).toBe(false)
    expect(vmRun).not.toHaveBeenCalled()
  })

  it('does not fetch, connect, or execute any network request during HTTP preview', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const requestSpy = vi.spyOn(process, 'emitWarning')
    const service = createMigrationPreviewService()
    const result = service.preview({ legacySkillId: 'http-no-network', type: 'http-api', source: { url: 'https://example.test/items', method: 'GET' } })
    expect(result.result.decision).toBe('manual_review')
    expect(result.result.sideEffects.network).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(requestSpy).not.toHaveBeenCalled()
  })

  it('keeps redaction fail-closed and does not expose secrets in generic redaction output', () => {
    const input = { Authorization: 'Bearer secret-token', nested: { password: 'secret-password' }, plain: 'Bearer secret-token' }
    const output = redactSecrets(input)
    expect(output).toEqual({ Authorization: '[REDACTED]', nested: { password: '[REDACTED]' }, plain: 'Bearer [REDACTED]' })
    expect(JSON.stringify(output)).not.toContain('secret-token')
    expect(JSON.stringify(output)).not.toContain('secret-password')
  })

  it('rejects unsupported source schemas rather than guessing an executable type', () => {
    const service = createMigrationPreviewService()
    const result = service.preview({ legacySkillId: 'unknown-type', type: 'Js-Function', source: 'return 1', executable: true })
    expect(result.result.decision).toBe('unsupported')
    expect(result.lifecycle).toBe('migration_blocked')
    expect(result.readOnly).toBe(true)
  })

  it('exposes a stable security code when the source envelope is invalid', () => {
    const service = createMigrationPreviewService()
    const result = service.preview({ legacySkillId: 'invalid-schema', type: 'prompt-template', source: { toJSON: () => 'execute' } })
    expect(result.result.decision).toBe('unsupported')
    expect(result.lifecycle).toBe('migration_blocked')
    expect(result.readOnly).toBe(true)
    expect(result.result.kind).toBe('unsupported-report')
    if (result.result.kind !== 'unsupported-report') throw new Error('Expected unsupported migration report')
    expect(result.result.blockers).toEqual(expect.arrayContaining([
      'Legacy source schema is damaged or outside the safe migration boundary',
    ]))

    try {
      normalizeLegacySource({ legacySkillId: 'invalid-schema', type: 'prompt-template', source: { toJSON: () => 'execute' } })
      throw new Error('expected normalizeLegacySource to reject the invalid source envelope')
    } catch (error) {
      expect(error).toMatchObject({ code: MIGRATION_ERROR_CODES.DAMAGED_SCHEMA })
    }
  })
})
