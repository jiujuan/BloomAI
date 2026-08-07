import { ServiceError } from '../../services/errors'
import { isLegacySkillReference, toPackageSkillReference } from '../../../shared/skill-references'
import type { JsonObject, PackageSkillRepository, RunSnapshot } from './ports'

type ChatSessionRepository = {
  get(id: string): { id: string } | undefined
}

type ChatMessageRepository = {
  save(data: { session_id: string; role: string; content: string; parts?: string | null }): unknown
}

type ChatRuntime = {
  startRun(input: {
    skillVersionId: string
    input: JsonObject
    context?: JsonObject
    surface?: 'skills' | 'chat' | 'image'
    sessionId?: string
    target?: { kind: 'chat' | 'image_session' | 'artifact_only'; id?: string }
  }): Promise<{ runId: string; status: string; revision: number }> | { runId: string; status: string; revision: number }
  findChatRunByIdempotency?(sessionId: string, idempotencyKey: string): Promise<RunSnapshot | undefined> | RunSnapshot | undefined
}

export type ChatSkillReference = {
  packageId: string
  packageReference: string
  packageName: string
  description: string
  skillVersionId: string
  version: string
  requiredCapabilities: string[]
}

export type SkillRunMessageData = {
  runId: string
  skillVersionId: string
  status: string
  sessionId: string
}

export type ChatSkillLauncherDependencies = {
  packages: Pick<PackageSkillRepository, 'listPackages' | 'listVersions' | 'listInstallations'>
  sessions: ChatSessionRepository
  messages: ChatMessageRepository
  runtime: ChatRuntime
}

export type StartChatSkillRunInput = {
  sessionId: string
  skillVersionId: string
  input: JsonObject
  idempotencyKey: string
  userMessage?: { content: string; parts?: unknown[] }
}

export type StartChatSkillRunResult = SkillRunMessageData & {
  revision: number
  created: boolean
}

export function buildSkillRunMessage(data: SkillRunMessageData): { content: string; parts: unknown[] } {
  return {
    content: '',
    parts: [{ type: 'data-skill-run', data }],
  }
}

export function createChatSkillLauncher(dependencies: ChatSkillLauncherDependencies) {
  function listChatEligibleSkills(): ChatSkillReference[] {
    const packages = dependencies.packages.listPackages({ limit: 100, offset: 0 }).data
    const references: ChatSkillReference[] = []
    for (const packageRecord of packages) {
      const versions = dependencies.packages.listVersions(packageRecord.id)
      const installations = dependencies.packages.listInstallations(packageRecord.id)
      for (const installation of installations) {
        if (!installation.enabled || installation.status !== 'installed') continue
        const version = versions.find((candidate) => candidate.id === installation.currentVersionId)
        if (!version || !version.isCompatible || version.runtime !== 'instruction-agent') continue
        const manifest = version.manifest ?? {}
        const requiredCapabilities = Array.isArray(manifest.requestedCapabilities)
          ? manifest.requestedCapabilities.map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object' && typeof (item as any).capability === 'string') return (item as any).capability
            return ''
          }).filter(Boolean)
          : []
        references.push({
          packageId: packageRecord.id,
          packageReference: toPackageSkillReference(packageRecord.id),
          packageName: packageRecord.name,
          description: packageRecord.description,
          skillVersionId: version.id,
          version: version.version,
          requiredCapabilities,
        })
      }
    }
    return references
  }

  async function startRunFromChat(input: StartChatSkillRunInput): Promise<StartChatSkillRunResult> {
    if (!dependencies.sessions.get(input.sessionId)) throw new ServiceError('NOT_FOUND', 'Chat session not found')
    if (!input.skillVersionId.trim()) throw new ServiceError('VALIDATION_ERROR', 'skillVersionId is required')
    if (!input.idempotencyKey.trim()) throw new ServiceError('VALIDATION_ERROR', 'idempotencyKey is required')
    if (isLegacySkillReference(input.skillVersionId)) {
      throw new ServiceError('LEGACY_SKILL_RUN_DISABLED', 'Legacy Skill execution is disabled; migrate it to a Package Skill before running', {
        legacyReference: input.skillVersionId,
        migrationAction: 'preview-legacy-skill-migration',
      })
    }

    const existing = await dependencies.runtime.findChatRunByIdempotency?.(input.sessionId, input.idempotencyKey)
    if (existing) {
      return {
        runId: existing.id,
        skillVersionId: existing.skillVersionId,
        status: existing.status,
        sessionId: input.sessionId,
        revision: existing.revision,
        created: false,
      }
    }

    const started = await dependencies.runtime.startRun({
      skillVersionId: input.skillVersionId,
      input: input.input,
      context: { chatIdempotencyKey: input.idempotencyKey },
      surface: 'chat',
      sessionId: input.sessionId,
      target: { kind: 'chat', id: input.sessionId },
    })
    const messageData = {
      runId: started.runId,
      skillVersionId: input.skillVersionId,
      status: started.status,
      sessionId: input.sessionId,
    }

    if (input.userMessage) {
      dependencies.messages.save({
        session_id: input.sessionId,
        role: 'user',
        content: input.userMessage.content,
        parts: input.userMessage.parts ? JSON.stringify(input.userMessage.parts) : null,
      })
    }
    const message = buildSkillRunMessage(messageData)
    dependencies.messages.save({
      session_id: input.sessionId,
      role: 'assistant',
      content: message.content,
      parts: JSON.stringify(message.parts),
    })

    return { ...messageData, revision: started.revision, created: true }
  }

  return { listChatEligibleSkills, startRunFromChat }
}
