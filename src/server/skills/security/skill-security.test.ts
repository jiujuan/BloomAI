import { describe, expect, it } from 'vitest'
import {
  MAX_SECURITY_STRING_LENGTH,
  assertArtifactOwnership,
  assertCapabilityAllowed,
  assertPackageLimits,
  getSkillSecurityStatus,
  sanitizeMarkdownHtml,
  sanitizeSecurityPayload,
  validateExternalSource,
  SkillSecurityError,
} from './skill-security-checklist'
import { auditSecurityDecision } from './security-audit.service'

describe('Skills runtime security checklist', () => {
  it('allows only canonical official GitHub sources and rejects SSRF-like sources', () => {
    expect(validateExternalSource({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skill',
      ref: 'main',
      subdirectory: 'skills/demo',
    })).toMatchObject({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skill',
      ref: 'main',
    })

    for (const repositoryUrl of [
      'http://github.com/acme/skill',
      'https://evil.example/acme/skill',
      'https://github.com.evil.example/acme/skill',
      'https://127.0.0.1/acme/skill',
      'https://github.com/acme/skill?download=1',
    ]) {
      expect(() => validateExternalSource({ kind: 'github-archive', repositoryUrl, ref: 'main' }))
        .toThrow(SkillSecurityError)
    }
    expect(() => validateExternalSource({ kind: 'github-archive', repositoryUrl: 'https://github.com/acme/skill', ref: '../main' }))
      .toThrow(/ref/i)
  })

  it('normalizes local paths and rejects control characters and oversized input', () => {
    const normalized = validateExternalSource({
      kind: 'local-directory',
      directory: `C:\\Temp\\${'ｅｘａｍｐｌｅ'}`,
    })
    expect(normalized.kind).toBe('local-directory')
    if (normalized.kind !== 'local-directory') throw new Error('Expected a normalized local-directory source')
    expect(normalized.directory).toContain('example')
    expect(() => validateExternalSource({ kind: 'zip', zipPath: `C:\\Temp\\bad\0.zip` })).toThrow(SkillSecurityError)
    expect(() => validateExternalSource({ kind: 'local-directory', directory: 'x'.repeat(MAX_SECURITY_STRING_LENGTH + 1) }))
      .toThrow(/length/i)
  })

  it('enforces file count, per-file, archive, and aggregate package budgets', () => {
    expect(() => assertPackageLimits({ fileCount: 3, totalBytes: 11, maxFileCount: 2, maxUnpackedBytes: 20 }))
      .toThrow(/file count/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 21, maxFileCount: 2, maxUnpackedBytes: 20 }))
      .toThrow(/bytes/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 1, fileBytes: 11, maxFileBytes: 10 }))
      .toThrow(/file/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 1, archiveBytes: 11, maxArchiveBytes: 10 }))
      .toThrow(/archive/i)
  })

  it('denies every dangerous package capability and permits the documented allowlist', () => {
    expect(assertCapabilityAllowed('web.fetch')).toBe('web.fetch')
    for (const capability of [
      'shell.execute',
      'python.execute',
      'mcp',
      'mcp.execute',
      'container.execute',
      'sub-agent.execute',
      'arbitrary_workspace_write',
      'workspace.write',
    ]) {
      expect(() => assertCapabilityAllowed(capability)).toThrow(SkillSecurityError)
    }
  })

  it('redacts secrets and bounds recursive event/audit payloads', () => {
    const sanitized = sanitizeSecurityPayload({
      prompt: 'do not persist this prompt',
      api_key: 'top-secret',
      nested: { authorization: 'Bearer secret', safe: 'ok' },
    }) as Record<string, any>
    expect(sanitized.api_key).toBe('[REDACTED]')
    expect(sanitized.nested.authorization).toBe('[REDACTED]')
    expect(sanitized.safe).toBeUndefined()
    expect(sanitized.nested.safe).toBe('ok')
    expect(() => sanitizeSecurityPayload({ deep: { value: { more: { tooDeep: true } } } }, { maxDepth: 2 }))
      .toThrow(/depth/i)
    expect(() => sanitizeSecurityPayload(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]))))
      .toThrow(/field/i)
  })

  it('sanitizes Markdown/HTML without allowing scripts, event handlers, or javascript URLs', () => {
    const safe = sanitizeMarkdownHtml('# title <script>alert(1)</script><a href="javascript:alert(1)" onclick="steal()">x</a>')
    expect(safe).not.toMatch(/script|onclick|javascript:/i)
    expect(safe).toContain('x')
  })

  it('requires artifact ownership before content or export operations', () => {
    expect(() => assertArtifactOwnership({ id: 'artifact-1', runId: 'run-1' }, 'run-2')).toThrow(/not found|ownership/i)
    expect(assertArtifactOwnership({ id: 'artifact-1', runId: 'run-1' }, 'run-1')).toBe(true)
  })

  it('records a redacted security decision and exposes only safe status fields', () => {
    const records: any[] = []
    auditSecurityDecision({
      audit: { append: (event) => records.push(event) },
      action: 'package.import.reviewed',
      resourceType: 'skill_import_review',
      resourceId: 'review-1',
      actor: 'admin-1',
      securityDecision: 'allow',
      sourceFingerprint: 'a'.repeat(64),
      payload: { secret: 'should-not-persist', prompt: 'raw prompt' },
    })
    expect(records[0]).toMatchObject({ securityDecision: 'allow', policyVersion: expect.any(String), sourceFingerprint: 'a'.repeat(64) })
    expect(JSON.stringify(records[0])).not.toContain('should-not-persist')
    expect(JSON.stringify(records[0])).not.toContain('raw prompt')

    expect(getSkillSecurityStatus()).toMatchObject({
      policyVersion: expect.any(String),
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'capability-default-deny', status: 'pass' }),
        expect.objectContaining({ id: 'source-allowlist', status: 'pass' }),
      ]),
    })
    expect(JSON.stringify(getSkillSecurityStatus())).not.toMatch(/secret|token|password|path/i)
  })
})
