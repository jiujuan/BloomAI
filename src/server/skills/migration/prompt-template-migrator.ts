import type { DraftCandidate, NormalizedLegacySource } from './migration.types'

const VARIABLE_PATTERN = /{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g
const UNSAFE_TEMPLATE_PATTERNS: Array<[string, RegExp, string]> = [
  ['TEMPLATE_URL', /\bhttps?:\/\//i, 'template contains a URL; network behavior requires an explicit capability review'],
  ['TEMPLATE_TOOL_CALL', /\b(?:tool|function_call|mcp)\s*\(/i, 'template contains a tool-call marker; do not infer a capability'],
  ['TEMPLATE_SCRIPT', /\b(?:script|eval|new\s+Function|import\s*\(|require\s*\()/i, 'template contains executable-code markers and cannot be auto-translated'],
]

export function migratePromptTemplateToDraftCandidate(source: NormalizedLegacySource): DraftCandidate {
  const template = typeof source.source === 'string' ? source.source : JSON.stringify(source.source)
  const templateVariables = [...new Set([...template.matchAll(VARIABLE_PATTERN)].map((match) => match[1]))].sort()
  const warnings = UNSAFE_TEMPLATE_PATTERNS.filter(([, pattern]) => pattern.test(template)).map(([code, , message]) => ({ code, message }))
  const decision = warnings.some((warning) => warning.code === 'TEMPLATE_SCRIPT') ? 'critical_blocked' : 'auto_convertible'
  const name = source.name
  const slug = toSlug(name, source.legacySkillId)
  const skillMd = renderSkillMarkdown(source, template, templateVariables)
  const capabilities: never[] = []
  return {
    kind: 'package-draft-candidate',
    schemaVersion: 1,
    legacySkillId: source.legacySkillId,
    sourceSha256: source.sourceSha256,
    manifest: {
      schemaVersion: 1,
      name,
      slug,
      version: source.version,
      description: source.description,
      entryPath: 'SKILL.md',
      runtime: 'instruction-agent',
      capabilities,
      files: ['SKILL.md'],
      compatibility: { legacySkillId: source.legacySkillId, sourceType: 'prompt-template' },
      unsupported: warnings.map((warning) => warning.code),
      extensions: {},
    },
    content: {
      name,
      slug,
      version: source.version,
      description: source.description,
      skillMd,
      references: {},
      assets: [],
      capabilities,
      visibility: 'private',
      ...(source.metadata.author && typeof source.metadata.author === 'string' ? { author: source.metadata.author } : {}),
    },
    inputSchema: buildInputSchema(source.inputSchema, templateVariables),
    outputSchema: source.outputSchema,
    templateVariables,
    warnings,
    decision,
    sideEffects: { network: false, model: false, runner: false, database: false, queue: false, publish: false },
  }
}

export const createPromptTemplateDraftCandidate = migratePromptTemplateToDraftCandidate

function buildInputSchema(input: unknown, variables: readonly string[]): unknown {
  if (isRecord(input) && Object.keys(input).length > 0) return input
  return { type: 'object', properties: Object.fromEntries(variables.map((name) => [name, { type: 'string' }])), required: [...variables], additionalProperties: false }
}

function renderSkillMarkdown(source: NormalizedLegacySource, template: string, variables: readonly string[]): string {
  const inputs = variables.length ? `\n\n## Inputs\n\n${variables.map((name) => '- ' + '`' + name + '`').join('\n')}` : ''
  const description = source.description || 'Deterministic migration candidate from a Legacy prompt-template Skill.'
  return `# ${source.name}\n\n${description}\n\n## Prompt template\n\n${template}${inputs}\n`
}

function toSlug(name: string, fallback: string): string {
  const slug = name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug || `legacy-${fallback.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 24) || 'skill'}`
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
