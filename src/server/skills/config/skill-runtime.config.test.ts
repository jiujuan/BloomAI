import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSkillRuntimeConfig,
  getSkillRuntimeCapabilities,
  loadSkillRuntimeConfig,
  setSkillRuntimeConfigForTests,
  SkillRuntimeConfigError,
} from './skill-runtime.config'

const root = () => fsPath(path.join(os.tmpdir(), `bloomai-skills-${Math.random().toString(16).slice(2)}`))
const fsPath = (value: string) => path.resolve(value)
const fsAdapter = { existsSync: () => false }

afterEach(() => setSkillRuntimeConfigForTests(undefined))

describe('skill runtime config', () => {
  it('uses secure defaults and exposes only non-sensitive capabilities', () => {
    const config = loadSkillRuntimeConfig({ NODE_ENV: 'production' }, fsAdapter)
    expect(config.runtimeEnabled).toBe(true)
    expect(config.packageExecutionEnabled).toBe(false)
    expect(config.importEnabled).toBe(false)
    expect(config.githubImportEnabled).toBe(false)
    expect(config.npxImportEnabled).toBe(false)
    expect(config.creatorPublishEnabled).toBe(false)
    expect(config.githubRequestTimeoutMs).toBe(15_000)
    expect(config.githubMaxArchiveBytes).toBe(100 * 1024 * 1024)
    expect(config.githubAllowedHosts).toEqual(['github.com', 'api.github.com', 'codeload.github.com'])
    expect(getSkillRuntimeCapabilities(config)).not.toHaveProperty('packageDataRoot')
  })

  it('accepts explicit boolean and numeric settings', () => {
    const config = loadSkillRuntimeConfig({
      SKILL_RUNTIME_ENABLED: 'true',
      SKILL_PACKAGE_EXECUTION_ENABLED: '1',
      SKILL_PACKAGE_IMPORT_ENABLED: 'yes',
      SKILL_GITHUB_IMPORT_ENABLED: 'on',
      SKILL_NPX_IMPORT_ENABLED: 'false',
      SKILL_WORKER_CONCURRENCY: '4',
      SKILL_MAX_ATTEMPTS: '5',
      SKILL_GITHUB_REQUEST_TIMEOUT_MS: '30000',
      SKILL_GITHUB_MAX_ARCHIVE_BYTES: '2000000',
      SKILL_GITHUB_ALLOWED_HOSTS: 'github.com, api.github.com, codeload.github.com',
      SKILL_PACKAGE_DATA_ROOT: root(),
      SKILL_EXPORT_ROOT: root(),
    }, fsAdapter)
    expect(config.workerConcurrency).toBe(4)
    expect(config.maxAttempts).toBe(5)
    expect(config.githubImportEnabled).toBe(true)
    expect(config.githubRequestTimeoutMs).toBe(30_000)
    expect(config.githubMaxArchiveBytes).toBe(2_000_000)
    expect(config.githubAllowedHosts).toEqual(['github.com', 'api.github.com', 'codeload.github.com'])
  })

  it.each([
    ['SKILL_RUNTIME_ENABLED', 'maybe'],
    ['SKILL_WORKER_CONCURRENCY', '0'],
    ['SKILL_MAX_ATTEMPTS', '-1'],
    ['SKILL_WORKER_CONCURRENCY', '1.5'],
    ['SKILL_GITHUB_REQUEST_TIMEOUT_MS', '0'],
    ['SKILL_GITHUB_MAX_ARCHIVE_BYTES', '0'],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => loadSkillRuntimeConfig({ [key]: value }, fsAdapter)).toThrow(SkillRuntimeConfigError)
  })

  it('rejects non-official GitHub hosts in the allowlist', () => {
    expect(() => loadSkillRuntimeConfig({ SKILL_GITHUB_ALLOWED_HOSTS: 'github.com,evil.example' }, fsAdapter)).toThrow(/official GitHub host/)
  })

  it('rejects relative paths and overlapping roots', () => {
    expect(() => loadSkillRuntimeConfig({ SKILL_PACKAGE_DATA_ROOT: 'relative' }, fsAdapter)).toThrow(/absolute path/)
    const shared = root()
    expect(() => loadSkillRuntimeConfig({ SKILL_PACKAGE_DATA_ROOT: shared, SKILL_EXPORT_ROOT: shared }, fsAdapter)).toThrow(/overlap/)
  })

  it('rejects unsafe feature combinations', () => {
    expect(() => loadSkillRuntimeConfig({ SKILL_PACKAGE_EXECUTION_ENABLED: 'true', SKILL_RUNTIME_ENABLED: 'false' }, fsAdapter)).toThrow(/requires runtimeEnabled/)
    expect(() => loadSkillRuntimeConfig({ SKILL_GITHUB_IMPORT_ENABLED: 'true' }, fsAdapter)).toThrow(/requires importEnabled/)
    expect(() => loadSkillRuntimeConfig({ SKILL_CREATOR_PUBLISH_ENABLED: 'true' }, fsAdapter)).toThrow(/requires creatorEnabled/)
  })

  it('checks manually assembled configs as well as env-derived configs', () => {
    const config = loadSkillRuntimeConfig({ SKILL_PACKAGE_DATA_ROOT: root(), SKILL_EXPORT_ROOT: root() }, fsAdapter)
    expect(assertSkillRuntimeConfig(config, fsAdapter)).toEqual(config)
  })
})
