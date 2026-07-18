import { createHash } from 'node:crypto'

export interface IterationQueryFingerprintInput {
  runId: string
  iterationId: string
  questionId: string
  intent: string
  query: string
  profile: string
  timeScope?: { from?: string; to?: string } | null
  policyVersion: string
}

const TRACKING_PARAMETERS = /^(utm_[^=]*|fbclid|gclid|dclid|mc_[^=]*|ref)$/i

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeResearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

/**
 * Deliberately conservative URL normalization used by all Deep Research retrieval paths.
 * The source record retains the provider-supplied original URL separately for auditability.
 */
export function canonicalizeResearchUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) source URLs are supported.')
  if (url.username || url.password) throw new Error('Source URLs must not include credentials.')
  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = ''
  url.hash = ''
  const parameters = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMETERS.test(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  url.search = ''
  for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue)
  return url.toString()
}

export function createIterationQueryFingerprint(input: IterationQueryFingerprintInput): string {
  return 'query:v2:' + input.runId + ':' + input.iterationId + ':' + sha256({
    questionId: input.questionId,
    intent: input.intent,
    query: normalizeResearchQuery(input.query),
    profile: input.profile,
    timeScope: input.timeScope ?? null,
    policyVersion: input.policyVersion,
  })
}

export function createSnapshotFingerprint(input: {
  runId: string
  sourceId: string
  finalUrl: string
  parserVersion: string
  contentHash: string
}): string {
  // Content identity is intentionally run-scoped: a matching body must be reused even
  // when providers surface it through a redirect or equivalent source URL.
  return 'snapshot:v2:' + input.runId + ':' + input.contentHash
}

export function createEvidenceFingerprint(input: {
  questionId: string
  snapshotId: string
  startOffset: number
  endOffset: number
  passage: string
}): string {
  return 'evidence:v2:' + sha256({
    questionId: input.questionId,
    snapshotId: input.snapshotId,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    passageHash: createHash('sha256').update(input.passage).digest('hex'),
  })
}

export function createIterationStepFingerprint(input: {
  runId: string
  iterationId: string
  step: 'plan' | 'retrieval' | 'assessment'
  inputFingerprint: string
}): string {
  return 'iteration-step:v1:' + input.runId + ':' + input.iterationId + ':' + input.step + ':' + input.inputFingerprint
}