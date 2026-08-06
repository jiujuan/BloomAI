import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRunCoordinator } from '../../../src/server/skills/runtime/skill-run-coordinator'

export const EXPECTED_SKILL_FIXTURES = [
  'minimal-valid-skill',
  'references-and-assets',
  'capability-approval-skill',
  'unsupported-capability-skill',
  'malicious-path-package',
  'npx-artifact-package',
  'github-archive-package',
  'invalid-manifest-package',
  'failing-runtime-skill',
  'image-skill',
] as const

const thisFile = fileURLToPath(import.meta.url)
export const SKILL_FIXTURE_ROOT = path.dirname(thisFile)

export function fixturePath(name: string, ...relativePath: string[]): string {
  if (!EXPECTED_SKILL_FIXTURES.includes(name as typeof EXPECTED_SKILL_FIXTURES[number])) {
    throw new Error(`Unknown skill fixture: ${name}`)
  }
  return path.join(SKILL_FIXTURE_ROOT, name, ...relativePath)
}

export function readFixtureManifest(name: string): string {
  return fs.readFileSync(fixturePath(name, 'SKILL.md'), 'utf8')
}

export function copySkillFixture(name: string, destination: string): string {
  const source = fixturePath(name)
  fs.mkdirSync(destination, { recursive: true })
  copyDirectoryContents(source, destination)
  return destination
}

export function createTestPackage(name: string, parent = os.tmpdir()): string {
  const destination = fs.mkdtempSync(path.join(parent, `skills-runtime-${name}-`))
  return copySkillFixture(name, destination)
}

export function createTestRun(
  coordinator: Pick<SkillRunCoordinator, 'startRun'>,
  input: { skillVersionId: string; input?: Record<string, unknown>; context?: Record<string, unknown> },
): string {
  return coordinator.startRun({
    skillVersionId: input.skillVersionId,
    input: input.input ?? {},
    context: input.context ?? {},
  }).runId
}

export type TestClock = {
  now: () => number
  setNow: (value: number) => void
}

export function createTestClock(initial = Date.now()): { clock: TestClock; advanceClock: (milliseconds: number) => number } {
  if (!Number.isFinite(initial)) throw new Error('Clock initial value must be finite')
  let now = initial
  const clock: TestClock = {
    now: () => now,
    setNow: (value) => {
      if (!Number.isFinite(value)) throw new Error('Clock value must be finite')
      now = value
    },
  }
  return { clock, advanceClock: (milliseconds) => advanceClock(clock, milliseconds) }
}

export function advanceClock(clock: Pick<TestClock, 'now' | 'setNow'>, milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) throw new Error('Clock advance must be finite')
  const next = clock.now() + milliseconds
  clock.setNow(next)
  return next
}

export type FakeGitHubArchive = {
  readonly archive: Buffer
  readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>
}

export function fakeGitHubArchive(entries: Array<{ name: string; content: string }> = [{ name: 'owner-repo-sha/SKILL.md', content: '# GitHub fixture\n' }]): FakeGitHubArchive {
  const archive = createStoredZip(entries)
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    const url = String(input)
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/zipball/')) return new Response(Uint8Array.from(archive), { status: 200, headers: { 'content-length': String(archive.length) } })
    return new Response('not found', { status: 404 })
  }
  return { archive, fetchImpl }
}

export async function killWorker(worker: { stop(options?: { drain?: boolean; timeoutMs?: number }): Promise<void> }): Promise<void> {
  await worker.stop({ drain: false, timeoutMs: 1_000 })
}

function copyDirectoryContents(source: string, destination: string): void {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true })
      copyDirectoryContents(sourcePath, destinationPath)
    } else {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
      fs.copyFileSync(sourcePath, destinationPath)
    }
  }
}

function createStoredZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const content = Buffer.from(entry.content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + content.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}
