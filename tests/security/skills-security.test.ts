import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixturePath } from '../fixtures/skills/fixture-utils'
import { SkillPackageReader, SkillPackageReadError } from '../../src/server/skills/packages/package-reader'
import { describeIgnoredFiles, detectNpxSkillsArtifact } from '../../src/server/skills/packages/npx-artifact-detector'
import { ManifestResolutionError, resolveSkillManifest } from '../../src/server/skills/packages/manifest-resolver'
import { GitHubSourceError, downloadGitHubArchive, parseGitHubSource } from '../../src/server/skills/packages/github-source'
import { assertArchiveEntryPath, normalizeSafeRelativePath } from '../../src/server/skills/packages/package-path-policy'
import { validateArtifactInput } from '../../src/server/skills/artifacts/artifact-policy'
import {
  assertArtifactOwnership,
  assertCapabilityAllowed,
  assertPackageLimits,
  isAllowedBrowserOrigin,
  sanitizeMarkdownHtml,
  sanitizeSecurityPayload,
  SkillSecurityError,
} from '../../src/server/skills/security/skill-security-checklist'
import { auditSecurityDecision } from '../../src/server/skills/security/security-audit.service'

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix = 'skills-security-'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init)
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('Skills Runtime security release cases', () => {
  it('rejects Zip Slip, absolute, drive-letter, malformed, and over-budget package paths', () => {
    for (const unsafePath of ['../outside.txt', '/etc/passwd', 'C:/Windows/system.ini', 'nested/../SKILL.md', 'nested//file.md', 'nested\\..\\file.md']) {
      expect(() => normalizeSafeRelativePath(unsafePath)).toThrow(/not allowed|path/i)
      expect(() => assertArchiveEntryPath(unsafePath)).toThrow(/not allowed|path/i)
    }

    expect(() => assertPackageLimits({ fileCount: 3, totalBytes: 1, maxFileCount: 2 })).toThrow(/file count/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 11, maxUnpackedBytes: 10 })).toThrow(/bytes/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 1, fileBytes: 11, maxFileBytes: 10 })).toThrow(/file/i)
    expect(() => assertPackageLimits({ fileCount: 1, totalBytes: 1, archiveBytes: 11, maxArchiveBytes: 10 })).toThrow(/archive/i)
  })

  it('rejects canonical symlink escapes when listing or reading a package', () => {
    const root = temporaryDirectory()
    const outside = temporaryDirectory('skills-security-outside-')
    writeFiles(root, { 'SKILL.md': '# Safe\n', 'references/secret.txt': 'do not read' })
    const outsideFile = path.join(outside, 'secret.txt')
    fs.writeFileSync(outsideFile, 'outside secret')
    const escapedPath = path.join(root, 'references', 'secret.txt')
    const originalRealpath = fs.realpathSync.native
    const realpathSpy = vi.spyOn(fs.realpathSync, 'native').mockImplementation((target) => {
      if (path.resolve(String(target)) === path.resolve(escapedPath)) return outsideFile
      return originalRealpath(target)
    })

    try {
      const reader = new SkillPackageReader(root)
      expect(() => reader.listFiles()).toThrow(SkillPackageReadError)
      expect(() => reader.readText('references/secret.txt')).toThrow(SkillPackageReadError)
    } finally {
      realpathSpy.mockRestore()
    }
  })

  it('rejects invalid manifests and executable entries without executing package scripts', () => {
    expect(() => resolveSkillManifest(fixturePath('invalid-manifest-package'))).toThrow(ManifestResolutionError)

    expect(() => resolveSkillManifest(fixturePath('malicious-path-package'))).toThrow(ManifestResolutionError)

    const executableEntryRoot = temporaryDirectory()
    writeFiles(executableEntryRoot, {
      'SKILL.md': '---\nname: executable-entry\nentry: scripts/run.js\n---\n# no execution\n',
      'scripts/run.js': 'throw new Error("must not execute")',
    })
    const executableManifest = resolveSkillManifest(executableEntryRoot)
    expect(executableManifest.compatible).toBe(false)
    expect(executableManifest.unsupported).toEqual(expect.arrayContaining([expect.stringContaining('entry:not_allowed')]))
  })

  it('imports npx artifacts as static content and ignores dependencies, hooks, and scripts', () => {
    const reader = new SkillPackageReader(fixturePath('npx-artifact-package'))
    const ignored = describeIgnoredFiles(reader)
    expect(ignored).toEqual(expect.arrayContaining([
      'package.json',
      'scripts/install.js',
    ]))
    expect(detectNpxSkillsArtifact(reader)).toMatchObject({
      isNpxArtifact: true,
      executionDisclaimer: expect.stringContaining('does not execute'),
    })
    expect(() => reader.executeCapability({ capability: 'package.read_text', input: { path: '../outside' } })).toThrow(SkillPackageReadError)
  })

  it('denies forbidden shell/python/mcp capabilities while retaining the explicit safe allowlist', () => {
    expect(assertCapabilityAllowed('WEB.SEARCH')).toBe('web.search')
    for (const capability of ['shell.execute', 'python.execute', 'mcp', 'mcp.execute', 'container.execute', 'workspace.write', 'dependency.install']) {
      expect(() => assertCapabilityAllowed(capability)).toThrow(SkillSecurityError)
    }
  })

  it('enforces official GitHub source canonicalization, host allowlist, and immutable redirects', async () => {
    expect(parseGitHubSource('https://github.com/acme/skills.git', 'main')).toMatchObject({
      owner: 'acme',
      repository: 'skills',
    })
    for (const repositoryUrl of [
      'http://github.com/acme/skills',
      'https://github.com.evil.example/acme/skills',
      'https://github.com/acme/skills?download=1',
      'https://github.com/acme/skills/tree/main',
      'https://127.0.0.1/acme/skills',
    ]) {
      expect(() => parseGitHubSource(repositoryUrl, 'main')).toThrow(GitHubSourceError)
    }

    const commitSha = 'a'.repeat(40)
    const fetchImpl = async (): Promise<Response> => response(null, {
      status: 302,
      headers: { location: 'https://evil.example/acme/skills/archive/' + commitSha + '.zip' },
    })
    await expect(downloadGitHubArchive(parseGitHubSource('https://github.com/acme/skills', 'main'), commitSha, { fetchImpl }))
      .rejects.toMatchObject({ code: 'GITHUB_REDIRECT_BLOCKED' })
  })

  it('records deterministic GitHub archive hash and rejects content-length mismatches', async () => {
    const commitSha = 'b'.repeat(40)
    const source = parseGitHubSource('https://github.com/acme/skills', 'main')
    const archive = Buffer.from('deterministic-archive')
    const fetchImpl = async (): Promise<Response> => response(archive, {
      status: 200,
      headers: { 'content-length': String(archive.length), etag: '"fixture"' },
    })
    const result = await downloadGitHubArchive(source, commitSha, {
      fetchImpl,
      now: () => new Date('2026-08-06T00:00:00.000Z'),
    })
    expect(result.archiveSha256).toBe(sha256(archive))
    expect(result.fetchedAt).toBe('2026-08-06T00:00:00.000Z')
    expect(result.etag).toBe('"fixture"')

    const mismatchFetch = async (): Promise<Response> => response(archive, {
      status: 200,
      headers: { 'content-length': String(archive.length + 1) },
    })
    await expect(downloadGitHubArchive(source, commitSha, { fetchImpl: mismatchFetch }))
      .rejects.toMatchObject({ code: 'GITHUB_CONTENT_LENGTH_MISMATCH' })
  })

  it('redacts secrets, bounds payloads, and sanitizes rendered HTML', () => {
    const payload = sanitizeSecurityPayload({
      api_key: 'secret',
      nested: { authorization: 'Bearer secret', safe: 'ok' },
      raw_prompt: 'private prompt',
    }) as Record<string, unknown>
    expect(payload).toMatchObject({ api_key: '[REDACTED]', raw_prompt: '[REDACTED]' })
    expect(payload.nested).toEqual({ authorization: '[REDACTED]', safe: 'ok' })
    expect(() => sanitizeSecurityPayload({ deep: { value: { tooDeep: true } } }, { maxDepth: 1 })).toThrow(/depth/i)

    const html = sanitizeMarkdownHtml('<script>alert(1)</script><a href="javascript:alert(1)" onclick="steal()">safe</a>')
    expect(html).not.toMatch(/script|javascript:|onclick/i)
    expect(html).toContain('safe')
  })

  it('prevents cross-run artifact access and validates image-reference artifact contracts', () => {
    expect(assertArtifactOwnership({ id: 'artifact-1', runId: 'run-1' }, 'run-1')).toBe(true)
    expect(() => assertArtifactOwnership({ id: 'artifact-1', runId: 'run-1' }, 'run-2')).toThrow(/ownership|not found/i)
    expect(() => assertArtifactOwnership({ id: 'artifact-1', runId: null }, 'run-1')).toThrow(SkillSecurityError)

    expect(validateArtifactInput({
      kind: 'image-reference',
      fileName: 'image.json',
      content: Buffer.from(JSON.stringify({ artifactId: 'image-1', mimeType: 'image/png' })),
      metadata: { runId: 'run-1' },
    })).toMatchObject({ mimeType: 'application/vnd.bloomai.image-reference+json' })
    expect(() => validateArtifactInput({ kind: 'image-reference', fileName: 'image.png', content: Buffer.from('x') }))
      .toThrow(/\.json|file name/i)
  })

  it('keeps security audit payloads redacted and browser origins allowlisted', () => {
    const records: Array<Record<string, unknown>> = []
    const event = auditSecurityDecision({
      audit: { append: (record) => records.push(record as unknown as Record<string, unknown>) },
      action: 'package.import.reviewed',
      resourceType: 'skill_import_review',
      resourceId: 'review-1',
      securityDecision: 'deny',
      actor: 'admin-1',
      payload: { token: 'do-not-store', nested: { password: 'secret' } },
    })
    expect(records).toHaveLength(1)
    expect(event.payload).toEqual({ token: '[REDACTED]', nested: { password: '[REDACTED]' } })
    expect(JSON.stringify(event)).not.toContain('do-not-store')

    expect(isAllowedBrowserOrigin('http://localhost')).toBe(true)
    expect(isAllowedBrowserOrigin('http://localhost.evil.example')).toBe(false)
    expect(isAllowedBrowserOrigin('javascript:alert(1)')).toBe(false)
  })
})

