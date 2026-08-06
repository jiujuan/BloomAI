import { toLegacySkillReference } from '../../../shared/skill-references'
import type { LegacySkillAdapter, LegacySkillView } from '../application/legacy-skill.adapter'
import { legacySkillAdapter } from '../application/legacy-skill.adapter'
import { ServiceError } from '../../services/errors'

export type LegacyMigrationPreview = {
  runtimeKind: 'legacy'
  legacySkillId: string
  legacyReference: string
  readOnly: true
  published: false
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  blockers: string[]
  recommendation: string
  templateVariables: string[]
  draft: {
    manifest: {
      schemaVersion: 1
      name: string
      slug: string
      version: string
      description: string
      entryPath: 'SKILL.md'
      runtime: 'instruction-agent'
      capabilities: []
      files: ['SKILL.md']
      compatibility: Record<string, unknown>
      unsupported: string[]
      extensions: Record<string, unknown>
    }
    skillMd: string
    source: 'legacy-prompt-template'
  } | null
}

type LegacyAdapterPort = Pick<LegacySkillAdapter, 'get'>

export function createLegacyToDraftService(overrides: { legacy?: LegacyAdapterPort } = {}) {
  const legacy = overrides.legacy ?? legacySkillAdapter

  return {
    preview(reference: string): LegacyMigrationPreview {
      const skill = legacy.get(reference)
      const { capabilityProfile } = skill
      const variables = extractTemplateVariables(skill.source)
      if (skill.type !== 'prompt-template' || !capabilityProfile.canConvertToPackage) {
        return {
          runtimeKind: 'legacy',
          legacySkillId: skill.id,
          legacyReference: toLegacySkillReference(skill.id),
          readOnly: true,
          published: false,
          riskLevel: capabilityProfile.riskLevel,
          blockers: capabilityProfile.blockers,
          recommendation: capabilityProfile.recommendation,
          templateVariables: variables,
          draft: null,
        }
      }

      return {
        runtimeKind: 'legacy',
        legacySkillId: skill.id,
        legacyReference: toLegacySkillReference(skill.id),
        readOnly: true,
        published: false,
        riskLevel: capabilityProfile.riskLevel,
        blockers: capabilityProfile.blockers,
        recommendation: capabilityProfile.recommendation,
        templateVariables: variables,
        draft: {
          manifest: {
            schemaVersion: 1,
            name: skill.name,
            slug: toSlug(skill.name, skill.id),
            version: skill.version || '0.1.0',
            description: skill.description || '',
            entryPath: 'SKILL.md',
            runtime: 'instruction-agent',
            capabilities: [],
            files: ['SKILL.md'],
            compatibility: { legacySkillId: skill.id, sourceType: skill.type },
            unsupported: [],
            extensions: {},
          },
          skillMd: renderSkillMd(skill, variables),
          source: 'legacy-prompt-template',
        },
      }
    },
  }
}

function extractTemplateVariables(source: string): string[] {
  return [...new Set([...source.matchAll(/{{\s*([A-Za-z_][\w.-]*)\s*}}/g)].map((match) => match[1]))].sort()
}

function renderSkillMd(skill: LegacySkillView, variables: string[]): string {
  const input = variables.length ? `\n\n### Inputs\n\n${variables.map((name) => `- \`${name}\``).join('\n')}` : ''
  return `# ${skill.name}\n\n${skill.description || 'Migrated from a Legacy prompt-template Skill.'}\n\n## Prompt template\n\n${skill.source}${input}\n`
}

function toSlug(name: string, fallback: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug || `legacy-${fallback.slice(0, 12)}`
}

function legacySkillAdapterFactoryType() { return legacySkillAdapter }
