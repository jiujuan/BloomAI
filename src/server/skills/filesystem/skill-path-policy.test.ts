import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SkillPathPolicyError,
  assertReadableWorkspace,
  cleanupRunArtifacts,
  resolveArtifactRunDirectory,
  resolveExportDestination,
} from './skill-path-policy'

const roots: string[] = []
function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('skill path policy', () => {
  it('accepts a real project directory but rejects traversal, UNC and symlink roots', () => {
    const root = tempRoot('bloomai-skill-path-')
    expect(assertReadableWorkspace(root)).toBe(fs.realpathSync.native(root))
    expect(() => assertReadableWorkspace('../outside')).toThrow(SkillPathPolicyError)
    expect(() => assertReadableWorkspace('\\\\server\\share')).toThrow(SkillPathPolicyError)

    const link = path.join(path.dirname(root), `${path.basename(root)}-link`)
    try {
      fs.symlinkSync(root, link, 'junction')
      roots.push(link)
      expect(() => assertReadableWorkspace(link)).toThrow(/symbolic link|junction/i)
    } catch (error: any) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error
    }
  })

  it('keeps run directories and exports inside their configured roots', () => {
    const artifactRoot = tempRoot('bloomai-artifacts-')
    const exportRoot = tempRoot('bloomai-exports-')
    const runDirectory = resolveArtifactRunDirectory(artifactRoot, 'run-123')
    expect(runDirectory).toBe(path.join(fs.realpathSync.native(artifactRoot), 'run-123'))
    expect(() => resolveArtifactRunDirectory(artifactRoot, '../escape')).toThrow(SkillPathPolicyError)
    expect(resolveExportDestination(exportRoot, exportRoot)).toBe(fs.realpathSync.native(exportRoot))
    expect(() => resolveExportDestination(exportRoot, path.dirname(exportRoot))).toThrow(/allowlist|inside/i)
  })

  it('cleans only an application-owned run directory and refuses symlinked targets', () => {
    const artifactRoot = tempRoot('bloomai-cleanup-')
    const runDirectory = resolveArtifactRunDirectory(artifactRoot, 'run-clean')
    fs.mkdirSync(runDirectory, { recursive: true })
    fs.writeFileSync(path.join(runDirectory, 'artifact.md'), 'content')
    expect(cleanupRunArtifacts(artifactRoot, 'run-clean')).toBe(true)
    expect(fs.existsSync(runDirectory)).toBe(false)

    const outside = tempRoot('bloomai-outside-')
    const linkDirectory = path.join(artifactRoot, 'run-link')
    try {
      fs.symlinkSync(outside, linkDirectory, 'junction')
      expect(() => cleanupRunArtifacts(artifactRoot, 'run-link')).toThrow(SkillPathPolicyError)
      expect(fs.existsSync(outside)).toBe(true)
    } catch (error: any) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error
    }
  })
})
