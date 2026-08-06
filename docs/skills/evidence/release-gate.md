# Release Gate Evidence（模板）

## 验收元数据

| 字段 | 值 |
|---|---|
| Release candidate | `<version/commit>` |
| Branch | `feat/skills-system-v1.1-impl` |
| Generated at (UTC) | `<YYYY-MM-DDTHH:mm:ssZ>` |
| CI run | `<job URL or artifact id>` |
| Owner / reviewer | `<name / name>` |
| Decision | `pending|accepted|blocked` |

## Required gates

| Gate | Command | Result | Evidence |
|---|---|---|---|
| Lint | `npm run lint` | `<exit code>` | `<log>` |
| Skills typecheck | `npm run typecheck:skills` | `<exit code>` | `<log>` |
| Unit | `npm run test:skills:unit` | `<exit code/count>` | `<JUnit>` |
| Integration | `npm run test:skills:integration` | `<exit code/count>` | `<JUnit>` |
| Security | `npm run test:skills:security` | `<exit code/count>` | [security scan](./security-scan.md) |
| Migration | `npm run test:skills:migration` | `<exit code/count>` | [migration snapshot](./migration-schema-snapshot.md) |
| Browser E2E | `npm run test:skills:e2e` | `<exit code/count>` | `<trace/video artifact>` |
| Release gate | `npm run test:skills:release-gate` | `<exit code>` | `<CI log>` |
| Diff check | `git diff --check` | `<exit code>` | `<log>` |

## Browser evidence

- Trace: `<.tmp/skills-evidence/.../trace.zip or CI artifact>`
- Video: `<.tmp/skills-evidence/.../*.webm or CI artifact>`
- Harness: `<offline deterministic harness description>`
- Flaky retry count: `<0 or explicit reason>`

Required flow: import/inspect → install/review → enable → run → approve → artifact → export; Creator draft → validate → preview → publish; disable/rollback/delete.

## Operational evidence

- Migration schema snapshot: `<path/artifact>`
- Health/readiness response: `<redacted JSON>`
- Metrics/log query: `<query and result>`
- Backup checksum: `<...>`
- Rollback rehearsal: [rollback checklist](./rollback-checklist.md)
- Orphan cleanup dry-run: `<command/result>`

## Acceptance

- [ ] All P0 tests pass in a clean offline environment.
- [ ] Security negative cases are present and passing.
- [ ] Browser trace/video is available or a documented deterministic harness was used.
- [ ] Legacy API and migration compatibility checks pass.
- [ ] No raw secret or development DB was used.
- [ ] Reviewer signed off; release owner is recorded.
