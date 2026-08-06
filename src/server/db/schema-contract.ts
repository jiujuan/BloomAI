export type SchemaContractDatabase = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

export type SchemaColumnContract = {
  notNull?: boolean
  primaryKey?: boolean
}

export type SchemaIndexContract = {
  columns: string[]
  unique?: boolean
  partial?: boolean
}

export type SchemaForeignKeyContract = {
  from: string
  table: string
  to: string
}

export type SchemaTableContract = {
  columns: Record<string, SchemaColumnContract>
  indexes?: Record<string, SchemaIndexContract>
  foreignKeys?: SchemaForeignKeyContract[]
}

export type SchemaContract = {
  tables: Record<string, SchemaTableContract>
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier in schema contract: ${identifier}`)
  }
  return `"${identifier}"`
}

function normalizeForeignKeys(rows: unknown[]): SchemaForeignKeyContract[] {
  return rows.map((row: any) => ({ from: String(row.from), table: String(row.table), to: String(row.to) }))
}

function readIndexes(db: SchemaContractDatabase, table: string): Map<string, { unique: boolean; partial: boolean; columns: string[] }> {
  const result = new Map<string, { unique: boolean; partial: boolean; columns: string[] }>()
  const indexRows = db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as any[]
  for (const row of indexRows) {
    const name = String(row.name)
    const columns = (db.prepare(`PRAGMA index_info(${quoteIdentifier(name)})`).all() as any[])
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((column) => String(column.name))
    result.set(name, {
      unique: Number(row.unique) === 1,
      partial: Number(row.partial) === 1,
      columns,
    })
  }
  return result
}

export function getExpectedSchemaContract(): SchemaContract {
  const id = { notNull: false, primaryKey: true }
  const required = { notNull: true }
  const optional = { notNull: false }
  return {
    tables: {
      skill_packages: {
        columns: {
          id,
          name: required,
          description: required,
          source_type: required,
          source_uri: optional,
          source_ref: optional,
          created_at: required,
          updated_at: required,
        },
      },
      skill_versions: {
        columns: {
          id,
          package_id: required,
          version: required,
          runtime: required,
          manifest_json: required,
          manifest_hash: required,
          package_path: required,
          source_snapshot_json: required,
          is_compatible: required,
          immutable_hash: required,
          status: required,
          security_status: required,
          snapshot_hash: required,
          published_at: optional,
          created_at: required,
        },
        indexes: {
          idx_skill_versions_package: { columns: ['package_id'] },
          idx_skill_versions_immutable_hash: { columns: ['package_id', 'immutable_hash'] },
        },
      },
      skill_installations: {
        columns: {
          id,
          package_id: required,
          current_version_id: required,
          status: required,
          enabled: required,
          installed_at: required,
          updated_at: required,
          previous_version_id: optional,
          revision: required,
          changed_at: optional,
          disabled_at: optional,
          uninstalled_at: optional,
          deleted_at: optional,
          rollback_reason: optional,
        },
        indexes: {
          idx_skill_installations_package: { columns: ['package_id'] },
          idx_skill_installations_current_version: { columns: ['current_version_id'] },
        },
      },
      skill_installation_commands: {
        columns: {
          id,
          installation_id: required,
          idempotency_key: required,
          result_json: required,
          created_at: required,
        },
        indexes: {
          idx_skill_installation_commands_installation: { columns: ['installation_id', 'created_at'] },
          idx_skill_installation_commands_idempotency: { columns: ['installation_id', 'idempotency_key'] },
        },
        foreignKeys: [{ from: 'installation_id', table: 'skill_installations', to: 'id' }],
      },
      skill_runs_v2: {
        columns: {
          id,
          skill_version_id: required,
          status: required,
          revision: required,
          input_json: required,
          output_json: optional,
          context_json: required,
          surface: optional,
          session_id: optional,
          image_session_id: optional,
          waiting_reason: optional,
          waiting_since: optional,
          waiting_expires_at: optional,
          cancel_requested: required,
          cancel_requested_at: optional,
          started_at: optional,
          updated_at: required,
          finished_at: optional,
          error_code: optional,
          error_message: optional,
          current_step: optional,
          required_action_json: optional,
          worker_id: optional,
          heartbeat_at: optional,
        },
        indexes: {
          idx_skill_runs_v2_version: { columns: ['skill_version_id'] },
          idx_skill_runs_v2_active_worker: { columns: ['status', 'worker_id', 'heartbeat_at'] },
          idx_skill_runs_v2_recovery: { columns: ['status', 'interrupted_at', 'cancel_requested'] },
          idx_skill_runs_v2_waiting_actions: { columns: ['status', 'waiting_expires_at'] },
        },
      },
      skill_run_events: {
        columns: {
          id,
          run_id: required,
          seq: required,
          schema_version: required,
          producer: required,
          occurred_at: required,
          type: required,
          payload_json: required,
          created_at: required,
        },
        indexes: {
          idx_skill_run_events_run_seq: { columns: ['run_id', 'seq'] },
          idx_skill_run_events_run_occurred: { columns: ['run_id', 'occurred_at', 'seq'] },
        },
      },
      skill_run_commands: {
        columns: {
          id,
          run_id: required,
          idempotency_key: required,
          result_json: required,
          created_at: required,
        },
        indexes: {
          idx_skill_run_commands_run: { columns: ['run_id', 'created_at'] },
        },
      },
      skill_artifacts: {
        columns: {
          id,
          run_id: required,
          kind: required,
          mime_type: optional,
          path: required,
          size_bytes: required,
          sha256: required,
          metadata_json: required,
          created_at: required,
          retention_until: optional,
          exported_at: optional,
          exported_by: optional,
        },
        indexes: {
          idx_skill_artifacts_run: { columns: ['run_id'] },
        },
      },
      skill_capability_grants: {
        columns: {
          id,
          skill_version_id: required,
          capability: required,
          grant_mode: required,
          scope_json: required,
          requested_scope_json: required,
          granted_scope_json: optional,
          status: required,
          granted_by: optional,
          granted_at: required,
          approved_by: optional,
          approved_at: optional,
          expires_at: optional,
          revoked_at: optional,
          revoke_reason: optional,
          session_id: optional,
          run_id: optional,
          owner_id: optional,
          max_calls: optional,
          calls_used: required,
          consumed_at: optional,
          idempotency_key: optional,
        },
        indexes: {
          idx_skill_capability_grants_version: { columns: ['skill_version_id'] },
          idx_skill_capability_grants_active: { columns: ['skill_version_id', 'capability', 'session_id'] },
          idx_skill_capability_grants_run: { columns: ['run_id', 'status'] },
          idx_skill_capability_grants_idempotency: { columns: ['run_id', 'idempotency_key'], unique: true, partial: true },
        },
      },
      skill_run_queue: {
        columns: {
          id,
          run_id: required,
          status: required,
          available_at: required,
          lease_owner: optional,
          lease_until: optional,
          attempt: required,
          last_error: optional,
          created_at: required,
          updated_at: required,
        },
        indexes: {
          idx_skill_run_queue_active_run: { columns: ['run_id'], unique: true, partial: true },
          idx_skill_run_queue_claim: { columns: ['status', 'available_at', 'lease_until'] },
        },
        foreignKeys: [{ from: 'run_id', table: 'skill_runs_v2', to: 'id' }],
      },
      skill_import_reviews: {
        columns: {
          id,
          source: required,
          source_sha: required,
          source_ref: optional,
          inspection_json: required,
          status: required,
          reviewer: optional,
          decision: optional,
          created_at: required,
          updated_at: required,
        },
        indexes: {
          idx_skill_import_reviews_source: { columns: ['source', 'source_sha', 'source_ref'], unique: true },
          idx_skill_import_reviews_status: { columns: ['status', 'updated_at'] },
        },
      },
      skill_audit_events: {
        columns: {
          id,
          actor: optional,
          action: required,
          resource_type: required,
          resource_id: optional,
          payload_json: required,
          created_at: required,
        },
        indexes: {
          idx_skill_audit_events_resource: { columns: ['resource_type', 'resource_id', 'created_at'] },
          idx_skill_audit_events_created: { columns: ['created_at'] },
        },
      },
      skill_drafts: {
        columns: {
          id,
          owner_id: required,
          status: required,
          revision: required,
          content_json: required,
          validation_json: required,
          base_version_id: optional,
          published_version_id: optional,
          created_at: required,
          updated_at: required,
        },
        indexes: {
          idx_skill_drafts_owner_status: { columns: ['owner_id', 'status', 'updated_at'] },
        },
        foreignKeys: [
          { from: 'base_version_id', table: 'skill_versions', to: 'id' },
          { from: 'published_version_id', table: 'skill_versions', to: 'id' },
        ],
      },
      skill_version_snapshots: {
        columns: {
          id,
          version_id: required,
          files_manifest_json: required,
          total_bytes: required,
          file_count: required,
          snapshot_root: required,
          snapshot_hash: required,
          created_at: required,
        },
        indexes: {
          idx_skill_version_snapshots_version: { columns: ['version_id'], unique: true },
          idx_skill_version_snapshots_hash: { columns: ['snapshot_hash'] },
        },
        foreignKeys: [{ from: 'version_id', table: 'skill_versions', to: 'id' }],
      },
      skill_version_diffs: {
        columns: {
          id,
          from_version_id: required,
          to_version_id: required,
          diff_json: required,
          created_at: required,
        },
        indexes: {
          idx_skill_version_diffs_versions: { columns: ['from_version_id', 'to_version_id'], unique: true },
        },
        foreignKeys: [
          { from: 'from_version_id', table: 'skill_versions', to: 'id' },
          { from: 'to_version_id', table: 'skill_versions', to: 'id' },
        ],
      },
    },
  }
}

export function assertSchemaContract(db: SchemaContractDatabase, contract = getExpectedSchemaContract()): void {
  const violations: string[] = []
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((row) => String(row.name)))

  for (const [tableName, tableContract] of Object.entries(contract.tables)) {
    if (!tables.has(tableName)) {
      violations.push(`missing table ${tableName}`)
      continue
    }

    const columns = new Map<string, any>((db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as any[]).map((row) => [String(row.name), row]))
    for (const [columnName, columnContract] of Object.entries(tableContract.columns)) {
      const row = columns.get(columnName)
      if (!row) {
        violations.push(`missing column ${tableName}.${columnName}`)
        continue
      }
      if (columnContract.notNull === true && Number(row.notnull) !== 1) {
        violations.push(`column ${tableName}.${columnName} must be NOT NULL`)
      }
      if (columnContract.primaryKey === true && Number(row.pk) !== 1) {
        violations.push(`column ${tableName}.${columnName} must be PRIMARY KEY`)
      }
    }

    const indexes = readIndexes(db, tableName)
    for (const [indexName, indexContract] of Object.entries(tableContract.indexes ?? {})) {
      const index = indexes.get(indexName)
      if (!index) {
        violations.push(`missing index ${indexName} on ${tableName}`)
        continue
      }
      if (indexContract.unique === true && !index.unique) violations.push(`index ${indexName} must be UNIQUE`)
      if (indexContract.partial === true && !index.partial) violations.push(`index ${indexName} must be partial`)
      if (JSON.stringify(index.columns) !== JSON.stringify(indexContract.columns)) {
        violations.push(`index ${indexName} columns mismatch: expected ${indexContract.columns.join(',')} got ${index.columns.join(',')}`)
      }
    }

    const foreignKeys = normalizeForeignKeys(db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`).all())
    for (const foreignKey of tableContract.foreignKeys ?? []) {
      if (!foreignKeys.some((candidate) => candidate.from === foreignKey.from && candidate.table === foreignKey.table && candidate.to === foreignKey.to)) {
        violations.push(`missing foreign key ${tableName}.${foreignKey.from} -> ${foreignKey.table}.${foreignKey.to}`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Schema contract violation:\n${violations.map((violation) => `- ${violation}`).join('\n')}`)
  }
}