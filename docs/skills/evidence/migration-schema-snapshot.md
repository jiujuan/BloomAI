# Migration Schema Snapshot（模板）

## 验收元数据

| 字段 | 值 |
|---|---|
| Task ID | `SKL-P0-002 / SKL-P8-003` |
| Branch | `feat/skills-system-v1.1-impl` |
| Commit | `<40-char SHA>` |
| Generated at (UTC) | `<YYYY-MM-DDTHH:mm:ssZ>` |
| DB engine | `SQLite` |
| Reviewer / status | `<name> / pending|accepted>` |

## Migration inventory

| Migration ID | Purpose | Repeatable | Forward-fix only | Compatibility note |
|---|---|---:|---:|---|
| `030-skill-runtime-queue-and-control-plane` | package/install/queue control plane | yes | yes | Legacy rows remain readable |
| `031-skill-version-drafts-and-snapshots` | immutable version/draft/snapshot | yes | yes | no implicit Legacy conversion |
| `032-skill-run-state-machine` | Run status/checkpoint/cancel | yes | yes | Run data is immutable history |
| `033-skill-run-event-protocol` | event seq/schema/producer | yes | yes | `(run_id, seq)` unique |
| `034-skill-run-execution-metrics` | runtime usage/metrics | yes | yes | metrics are append/read safe |
| `035-skill-run-recovery` | recovery/reconciliation fields | yes | yes | lease expiry is recoverable |
| `036-skill-capability-grant-lifecycle` | requested/granted/usage | yes | yes | granted scope subset |
| `037-skill-run-waiting-actions` | approval/waiting actions | yes | yes | duplicate action safe |
| `038-skill-artifact-retention-export` | retention/export ownership | yes | yes | soft-delete preserves audit |
| `039-skill-version-lifecycle` | current/runnable lifecycle | yes | yes | current pointer explicit |
| `040-skill-lifecycle-delete` | soft delete/tombstone | yes | yes | no destructive app rollback |
| `041-skill-artifact-policy` | artifact policy metadata | yes | yes | hash/size/mime consistent |
| `042-image-studio-skill-links` | image session/artifact links | yes | yes | image provider mocked in CI |
| `043-skill-security-audit-fields` | security audit/redaction fields | yes | yes | secrets never persisted |

> 如果实现增加或重命名 migration，必须在本表记录实际 ID，并同步 runbook。

## Schema assertions

- [ ] Empty DB applies all migrations once.
- [ ] Current legacy DB upgrades without dropping Legacy tables/rows.
- [ ] Re-running migrations is a no-op.
- [ ] Migration status exposes current/applied/pending IDs.
- [ ] `(run_id, seq)` and `(run_id, idempotency_key)` are unique.
- [ ] Queue has one active lease owner per Run.
- [ ] Active Installation current version belongs to the same package and is runnable.
- [ ] Grant scope is a subset of requested scope and usage cannot exceed budget.
- [ ] Artifact run ownership, SHA-256, size and MIME agree.
- [ ] Soft delete preserves Run/Event/Artifact audit queryability.
- [ ] All UTC timestamps and revision values use the documented DTO convention.

## Snapshot

```text
DB: <TEMP_DB>
Applied: <migration ids>
Current: <migration id>
Pending: <none|ids>
Tables/indexes/constraints: <path to redacted snapshot>
Legacy row counts: <counts only, no user content>
```

## Verification commands

```powershell
npm run typecheck:skills
npm run test:skills:migration
```

Result: `<exit code / test files / assertions>`

## Recovery evidence

- Backup artifact and checksum: `<CI artifact / SHA-256>`
- Restore rehearsal: `<command/result>`
- Forward-fix rehearsal: `<migration id / command/result>`
- App rollback with new schema retained: `<result>`
