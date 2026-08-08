# SKL12-P2-001 Package/Import/Installation API evidence

Date: 2026-08-08
Branch: `feat/skills-admin-system`

## Scope

Implemented the Package Runtime HTTP contract for package inspection/import, import review decisions, catalog/detail/version APIs, installation lifecycle mutations, and package soft deletion.

The change keeps Package Runtime as the only current management surface and does not re-enable Legacy management or execution. Administrative identity is resolved from the authenticated transport context (`x-bloom-actor`/`x-bloom-owner` adapter); request bodies cannot supply a reviewer or actor identity.

## Evidence matrix

| Acceptance point | Evidence |
|---|---|
| User read access and admin-only package/import/installation writes | `skill-package-runtime.p2.test.ts` verifies catalog reads succeed for `user` while inspect, install, installation disable, and package delete return `403 FORBIDDEN` with a request id. |
| Import inspect/install and review decisions | Existing integration coverage in `skill-package-runtime.test.ts` verifies inspect is non-persistent, install creates the reviewed installation state, and approve/reject transitions are exposed through HTTP. |
| Spoofed reviewer rejected | `skill-package-runtime.p2.test.ts` posts `{ reviewer: ... }` to approve and receives `400 VALIDATION_ERROR`; the authenticated actor header is the only accepted reviewer source. |
| Strict payload validation | The same contract test posts an unexpected install field and receives `400 VALIDATION_ERROR`; mutation/query schemas are strict. |
| Catalog search/filter/archive/sort/pagination | `skill-package-runtime.p2.test.ts` verifies search, `sourceType`, `includeArchived`, `name` ascending sort, stable page offset, and that `meta.page.total` matches the filtered result set. |
| Revision and idempotency | Existing integration coverage verifies duplicate uninstall/switch/command requests are replay-safe and stale installation/run revisions return `REVISION_CONFLICT`. |
| Installation lifecycle and soft-delete semantics | Existing integration coverage verifies enable/disable, switch, rollback, uninstall, soft delete, preservation of versions/installations/audit history, and blocking deletion while an active run exists. |
| Audit context | Runtime lifecycle writes append audit records with authenticated actor, request id, action, resource id, `securityDecision: allowed`, and policy version `skills-admin-v1.2`; the P2 contract test queries the audit API and verifies actor/action/resource id. |
| Verified runtime safety boundary | Existing integration coverage continues to reject unverified/incompatible versions and Legacy run references before runtime execution. |

## Commands and results

```text
npm test -- --run src/server/http/routes/skill-package-runtime.p2.test.ts
PASS: 1 test file, 4 tests

npm test -- --run src/server/http/routes/skill-package-runtime.test.ts
PASS: 1 test file, 18 tests

npm run typecheck:skills
PASS

git diff --check
PASS (only pre-existing line-ending warnings from Git were reported)
```

## Changed files

- `src/server/http/skills-policy.ts`
- `src/server/http/routes/skill-package-runtime.ts`
- `src/server/http/routes/skill-package-runtime.test.ts`
- `src/server/http/routes/skill-package-runtime.p2.test.ts`
- `src/server/services/skill-package-runtime.service.ts`
- `src/server/skills/application/skill-lifecycle.service.ts`
- `src/server/skills/application/ports.ts`
- `src/server/db/repositories/skill-package.repo.ts`

## Compatibility, risks, and rollback

- No Legacy route, repository, runtime, or feature flag was restored.
- Version switching still requires a verified, runnable, compatible version.
- Package deletion remains a soft-delete and is blocked when active runs would make historical references unsafe to remove.
- Rollback is the single commit for this task; reverting it restores the previous HTTP contract and catalog query behavior.

The final task commit SHA is reported in the task completion message and Git history.
