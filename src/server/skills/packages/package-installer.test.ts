import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let fixtureDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof fetch

async function loadInstaller() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir
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

  it('does not install while the package runtime feature flag is disabled', async () => {
    const { PackageInstaller, PackageInstallError } = await loadInstaller()
    process.env.SKILL_PACKAGE_RUNTIME_ENABLED = 'false'

    await expect(new PackageInstaller().inspect({ kind: 'local-directory', directory: fixtureDir })).rejects.toBeInstanceOf(PackageInstallError)
    expect(fs.existsSync(path.join(dataDir, 'skills', 'packages'))).toBe(false)
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

  it('pins GitHub archive installation to the resolved commit SHA', async () => {
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
      `https://github.com/owner/repo/archive/${'a'.repeat(40)}.zip`,
      'https://api.github.com/repos/owner/repo/commits/main',
      `https://github.com/owner/repo/archive/${'a'.repeat(40)}.zip`,
      'https://api.github.com/repos/owner/repo/commits/main',
      `https://github.com/owner/repo/archive/${'a'.repeat(40)}.zip`,
    ])
    expect(result.packages[0].sourceSnapshot.sourceCommit).toBe('a'.repeat(40))
  })

  it('creates a new immutable version when a GitHub ref resolves to a new commit', async () => {
    const firstArchivePath = path.join(fixtureDir, 'archive-a.zip')
    const secondArchivePath = path.join(fixtureDir, 'archive-b.zip')
    writeStoredZip(firstArchivePath, [{ name: 'owner-repo-sha/skills/illustrator/SKILL.md', content: '# Remote A\n' }])
    writeStoredZip(secondArchivePath, [{ name: 'owner-repo-sha/skills/illustrator/SKILL.md', content: '# Remote B\n' }])
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
    await installer.install(source, { reviewId: first.reviewId, sourceFingerprint: first.sourceFingerprint, confirm: true })

    currentSha = 'b'.repeat(40)
    const second = await installer.inspect(source)
    await installer.install(source, { reviewId: second.reviewId, sourceFingerprint: second.sourceFingerprint, confirm: true })

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
})
