import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isScopeSubset, normalizeCapabilityScope } from '../skills/policy/capability-policy'

export type SkillRuntimeInvariantDatabase = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

export type SkillRuntimeInvariantOptions = {
  /** Root used to resolve the relative artifact paths persisted by ArtifactStore. */
  readonly artifactRoot?: string
}

type RuntimeRow = Record<string, unknown>

function rows(db: SkillRuntimeInvariantDatabase, sql: string, ...params: unknown[]): RuntimeRow[] {
  return db.prepare(sql).all(...params) as RuntimeRow[]
}

function fail(message: string): never {
  throw new Error(`Skill runtime invariant violation: ${message}`)
}

function isEpochMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0 && value <= 4_102_444_800_000
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'string') fail(`${label} must be JSON text`)
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label} must be a JSON object`)
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Skill runtime invariant violation:')) throw error
    fail(`${label} must be valid JSON`)
  }
}

function resolveArtifactPath(row: RuntimeRow, options: SkillRuntimeInvariantOptions): string {
  const storedPath = String(row.path ?? '')
  if (path.isAbsolute(storedPath)) return path.resolve(storedPath)
  if (!options.artifactRoot) fail(`Artifact ${String(row.id)} uses a relative path without artifactRoot`)
  const runId = String(row.run_id ?? '')
  const root = path.resolve(options.artifactRoot)
  const candidate = path.resolve(root, runId, storedPath)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) fail(`Artifact ${String(row.id)} escapes artifactRoot`)
  return candidate
}

function expectedMimeForPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }[extension]
}

function assertVersionsAndRuns(db: SkillRuntimeInvariantDatabase): void {
  const invalidRuns = rows(db, `
    SELECT r.id AS run_id, v.id AS version_id, v.immutable_hash, v.status, v.is_compatible
    FROM skill_runs_v2 r
    LEFT JOIN skill_versions v ON v.id = r.skill_version_id
    WHERE v.id IS NULL
       OR trim(COALESCE(v.immutable_hash, '')) = ''
       OR v.status <> 'runnable'
       OR v.is_compatible <> 1
  `)
  if (invalidRuns.length > 0) {
    const row = invalidRuns[0]
    fail(`Run ${String(row.run_id)} must reference an immutable runnable SkillVersion (${String(row.version_id ?? 'missing')})`)
  }

  const invalidInstallations = rows(db, `
    SELECT i.id AS installation_id, i.package_id, i.current_version_id,
           p.id AS version_package_id, v.status AS version_status, v.is_compatible,
           v.immutable_hash
    FROM skill_installations i
    LEFT JOIN skill_packages p ON p.id = i.package_id
    LEFT JOIN skill_versions v ON v.id = i.current_version_id
    WHERE COALESCE(i.deleted_at, 0) = 0
      AND COALESCE(i.uninstalled_at, 0) = 0
      AND i.enabled = 1
      AND i.status NOT IN ('disabled', 'uninstalled', 'deleted')
      AND (v.id IS NULL OR p.id IS NULL OR v.package_id <> i.package_id
        OR trim(COALESCE(v.immutable_hash, '')) = ''
        OR v.status <> 'runnable'
        OR v.is_compatible <> 1)
  `)
  if (invalidInstallations.length > 0) {
    const row = invalidInstallations[0]
    fail(`active Installation current_version_id must point to the same package and a runnable immutable SkillVersion (${String(row.installation_id)})`)
  }
}

function assertGrants(db: SkillRuntimeInvariantDatabase): void {
  for (const row of rows(db, `
    SELECT id, requested_scope_json, granted_scope_json, max_calls, calls_used
    FROM skill_capability_grants
  `)) {
    const requested = normalizeCapabilityScope(parseJsonObject(row.requested_scope_json, `grant ${String(row.id)} requested_scope_json`))
    const granted = row.granted_scope_json === null || row.granted_scope_json === undefined
      ? requested
      : normalizeCapabilityScope(parseJsonObject(row.granted_scope_json, `grant ${String(row.id)} granted_scope_json`))
    if (!isScopeSubset(granted, requested)) fail(`grant granted scope must be a subset of requested scope (${String(row.id)})`)

    const callsUsed = Number(row.calls_used)
    if (!Number.isInteger(callsUsed) || callsUsed < 0) fail(`grant calls_used must be a non-negative integer (${String(row.id)})`)
    if (row.max_calls !== null && row.max_calls !== undefined) {
      const maxCalls = Number(row.max_calls)
      if (!Number.isInteger(maxCalls) || maxCalls <= 0) fail(`grant max_calls must be a positive integer (${String(row.id)})`)
      if (callsUsed > maxCalls) fail(`grant calls_used must not exceed max_calls (${String(row.id)})`)
    }
  }
}

function assertArtifacts(db: SkillRuntimeInvariantDatabase, options: SkillRuntimeInvariantOptions): void {
  for (const row of rows(db, `
    SELECT id, run_id, path, mime_type, size_bytes, sha256
    FROM skill_artifacts
  `)) {
    const runId = String(row.run_id)
    const owner = rows(db, 'SELECT id FROM skill_runs_v2 WHERE id = ?', runId)
    if (owner.length !== 1) fail(`Artifact ${String(row.id)} must belong to an existing Run (${runId})`)

    const artifactPath = resolveArtifactPath(row, options)
    let content: Buffer
    try {
      content = fs.readFileSync(artifactPath)
    } catch {
      fail(`Artifact ${String(row.id)} file is missing or unreadable`)
    }
    const expectedSha = crypto.createHash('sha256').update(content).digest('hex')
    if (String(row.sha256).toLowerCase() !== expectedSha) fail(`Artifact metadata does not match file contents (${String(row.id)} sha256)`)
    if (Number(row.size_bytes) !== content.byteLength) fail(`Artifact metadata does not match file contents (${String(row.id)} size_bytes)`)

    const mimeType = row.mime_type === null || row.mime_type === undefined ? undefined : String(row.mime_type)
    const expectedMime = expectedMimeForPath(artifactPath)
    if (mimeType && expectedMime && mimeType !== expectedMime) fail(`Artifact metadata does not match file contents (${String(row.id)} mime_type)`)
  }
}

function assertTimestampsAndRevisions(db: SkillRuntimeInvariantDatabase): void {
  const timestampColumns: Array<[string, string]> = [
    ['skill_packages', 'created_at'], ['skill_packages', 'updated_at'], ['skill_packages', 'deleted_at'],
    ['skill_versions', 'created_at'], ['skill_versions', 'published_at'],
    ['skill_installations', 'installed_at'], ['skill_installations', 'updated_at'], ['skill_installations', 'changed_at'],
    ['skill_installations', 'disabled_at'], ['skill_installations', 'uninstalled_at'], ['skill_installations', 'deleted_at'],
    ['skill_runs_v2', 'updated_at'], ['skill_runs_v2', 'started_at'], ['skill_runs_v2', 'finished_at'],
    ['skill_runs_v2', 'waiting_since'], ['skill_runs_v2', 'waiting_expires_at'], ['skill_runs_v2', 'cancel_requested_at'],
    ['skill_runs_v2', 'interrupted_at'], ['skill_runs_v2', 'heartbeat_at'], ['skill_runs_v2', 'last_heartbeat_at'],
    ['skill_run_events', 'occurred_at'], ['skill_run_events', 'created_at'], ['skill_run_commands', 'created_at'],
    ['skill_artifacts', 'created_at'], ['skill_artifacts', 'retention_until'], ['skill_artifacts', 'exported_at'],
    ['skill_capability_grants', 'granted_at'], ['skill_capability_grants', 'approved_at'], ['skill_capability_grants', 'expires_at'],
    ['skill_capability_grants', 'revoked_at'], ['skill_capability_grants', 'consumed_at'], ['skill_run_queue', 'available_at'],
    ['skill_run_queue', 'lease_until'], ['skill_run_queue', 'created_at'], ['skill_run_queue', 'updated_at'],
    ['skill_audit_events', 'created_at'], ['skill_drafts', 'created_at'], ['skill_drafts', 'updated_at'],
    ['skill_version_snapshots', 'created_at'], ['skill_version_diffs', 'created_at'],
  ]
  for (const [table, column] of timestampColumns) {
    for (const row of rows(db, `SELECT rowid, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)) {
      if (!isEpochMilliseconds(row.value)) fail(`UTC epoch-millisecond timestamp required: ${table}.${column} row ${String(row.rowid)}`)
    }
  }

  for (const [table, column] of [['skill_runs_v2', 'revision'], ['skill_installations', 'revision'], ['skill_drafts', 'revision']] as const) {
    for (const row of rows(db, `SELECT rowid, ${column} AS value FROM ${table}`)) {
      if (!Number.isInteger(Number(row.value)) || Number(row.value) < 0) fail(`${table}.${column} must be a non-negative integer`)
    }
  }
}

/**
 * Runs the cross-table checks that SQLite constraints cannot express alone.
 * It is intentionally read-only so it can be used during migration rehearsal,
 * diagnostics, and release evidence without mutating the database.
 */
export function assertSkillRuntimeDataInvariants(
  db: SkillRuntimeInvariantDatabase,
  options: SkillRuntimeInvariantOptions = {},
): void {
  assertVersionsAndRuns(db)
  assertGrants(db)
  assertArtifacts(db, options)
  assertTimestampsAndRevisions(db)
}