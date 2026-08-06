import path from 'node:path'
import type { SkillPackageReader } from './package-reader'

export type NpxArtifactLayout = 'single-skill' | 'skills-directory' | 'dot-skills-directory' | 'mixed' | 'unknown'

export type NpxSkillsArtifact = {
  isNpxArtifact: boolean
  layout: NpxArtifactLayout
  skillRoots: string[]
  ignoredPaths: string[]
  ignoredFiles: string[]
  executionDisclaimer?: string
}

export const NPX_EXECUTION_DISCLAIMER = 'BloomAI does not execute npx, npm, package scripts, or install dependencies; this artifact is imported as static files only.'

export function selectSkillRoots(reader: SkillPackageReader): string[] {
  const roots = reader.listFiles()
    .filter((file) => path.posix.basename(file) === 'SKILL.md' && !isIgnoredPath(file))
    .map((file) => path.posix.dirname(file))
    .map((root) => root === '' ? '.' : root)
  return [...new Set(roots)].sort((a, b) => a.localeCompare(b))
}

export function describeIgnoredFiles(reader: SkillPackageReader): string[] {
  return reader.listFiles().filter(isIgnoredPath).sort((a, b) => a.localeCompare(b))
}

export function detectNpxSkillsArtifact(reader: SkillPackageReader): NpxSkillsArtifact {
  const skillRoots = selectSkillRoots(reader)
  const ignoredPaths = describeIgnoredFiles(reader)
  const layout = classifyLayout(skillRoots)
  const isNpxArtifact = layout === 'skills-directory' || layout === 'dot-skills-directory' || layout === 'mixed' || ignoredPaths.length > 0
  return {
    isNpxArtifact,
    layout,
    skillRoots,
    ignoredPaths,
    ignoredFiles: ignoredPaths,
    ...(isNpxArtifact ? { executionDisclaimer: NPX_EXECUTION_DISCLAIMER } : {}),
  }
}

export function isIgnoredArtifactPath(relativePath: string): boolean {
  return isIgnoredPath(relativePath)
}

function classifyLayout(skillRoots: string[]): NpxArtifactLayout {
  if (skillRoots.length === 0) return 'unknown'
  const hasRootSkill = skillRoots.includes('.')
  const hasSkillsDirectory = skillRoots.some((root) => root === 'skills' || root.startsWith('skills/'))
  const hasDotSkillsDirectory = skillRoots.some((root) => root === '.skills' || root.startsWith('.skills/'))
  if (skillRoots.length === 1 && hasRootSkill) return 'single-skill'
  if (hasSkillsDirectory && !hasDotSkillsDirectory && !hasRootSkill) return 'skills-directory'
  if (hasDotSkillsDirectory && !hasSkillsDirectory && !hasRootSkill) return 'dot-skills-directory'
  if (hasRootSkill || hasSkillsDirectory || hasDotSkillsDirectory) return 'mixed'
  return 'unknown'
}

function isIgnoredPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '')
  const segments = normalized.split('/').filter(Boolean)
  const lowerSegments = segments.map((segment) => segment.toLowerCase())
  const basename = lowerSegments.at(-1) ?? ''
  if (lowerSegments.some((segment) => ['.git', 'node_modules', '.pnpm', '.yarn'].includes(segment))) return true
  if (['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(basename)) return true
  if (lowerSegments.some((segment) => ['scripts', 'hooks'].includes(segment))) return true
  if (/\.(sh|bash|zsh|fish|bat|cmd|ps1|psm1|vbs|exe|dll)$/i.test(basename)) return true
  if (/^(pre|post)?(install|prepare)(\.[^.]+)?$/i.test(basename)) return true
  return false
}
