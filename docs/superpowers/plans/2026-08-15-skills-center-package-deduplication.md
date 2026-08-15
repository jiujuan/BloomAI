# Skills Center Package Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove existing duplicate active Skill packages while retaining the newest package, and prevent repeated scans of an already active import from creating duplicates.

**Architecture:** Keep package history and foreign-key relationships intact by soft-archiving older records in a numbered SQLite migration. Preserve import idempotency by checking the package IDs recorded in an installed import review before resetting that review for a potential reimport; reset only when every previously installed package is archived or absent.

**Tech Stack:** TypeScript, Drizzle ORM, SQLite migrations, Vitest.

---

## File Structure

- Modify: `src/server/db/repositories/skill-package.repo.ts` — retain installed import reviews if they reference at least one active package.
- Modify: `src/server/skills/packages/package-installer.test.ts` — cover repeat installation of the same active source and preserve archived-package reimport coverage.
- Create: `scripts/migrations/049-deduplicate-active-skill-packages.sql` — soft-archive superseded active records using logical package identity and recency ordering.
- Create: `scripts/migrations/049-deduplicate-active-skill-packages.test.ts` — run the migration in an isolated SQLite fixture and verify latest-record retention.

### Task 1: Preserve active import idempotency

**Files:**
- Modify: `src/server/skills/packages/package-installer.test.ts`
- Modify: `src/server/db/repositories/skill-package.repo.ts`

- [ ] **Step 1: Write the failing repeat-install test**

Add a test that inspects and installs one local `article/SKILL.md`, then inspects and installs the exact same directory again. Assert the second installation returns the original package ID and the `skill_packages` table still contains exactly one row.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/server/skills/packages/package-installer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`

Expected: the repeat-install assertion fails because a second Package is created.

- [ ] **Step 3: Add an active-package guard for installed reviews**

In `createImportReview`, parse the installed review decision defensively, collect `decision.result.packages[*].packageId`, and look up these IDs in `skill_packages`. Return the installed review unchanged when any package has `deleted_at IS NULL`; otherwise use the current reset path so archived packages can be reimported.

- [ ] **Step 4: Re-run the focused test**

Run: `npx vitest run src/server/skills/packages/package-installer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`

Expected: all installer tests pass, including the existing archived-package reimport test.

### Task 2: Deduplicate current active Package data

**Files:**
- Create: `scripts/migrations/049-deduplicate-active-skill-packages.sql`
- Create: `scripts/migrations/049-deduplicate-active-skill-packages.test.ts`

- [ ] **Step 1: Write a migration test with old/new duplicate records**

Create a temporary SQLite database with `skill_packages` rows for an older and newer instance of one logical identity plus a different-source control row. Execute only migration 049 and assert the newest duplicate remains active, the older row receives a deletion timestamp and `Superseded by newer duplicate import` reason, and the control row remains active.

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `npx vitest run scripts/migrations/049-deduplicate-active-skill-packages.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`

Expected: FAIL because migration 049 does not yet exist.

- [ ] **Step 3: Implement the data migration**

Use `ROW_NUMBER()` partitioned by `name`, `source_type`, `COALESCE(source_uri, '')`, and `COALESCE(source_ref, '')`; rank by `updated_at DESC`, `created_at DESC`, and `id DESC`; set `deleted_at` to the current SQLite millisecond timestamp and `delete_reason` to `Superseded by newer duplicate import` for rows with rank greater than one.

- [ ] **Step 4: Re-run the migration test**

Run: `npx vitest run scripts/migrations/049-deduplicate-active-skill-packages.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`

Expected: PASS.

### Task 3: Verify and apply the production migration

**Files:**
- Verify: `C:/Users/xing/.bloomai/bloomai.db`

- [ ] **Step 1: Run required Skills verification**

Run:

```powershell
npx vitest run src/server/skills/packages/package-installer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
npm run typecheck:skills
npm run test:skills:unit
npm run test:skills:migration
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Apply pending SQL migrations to the existing desktop database**

Start the application or invoke the repository migration runner against `C:/Users/xing/.bloomai/bloomai.db` once, then confirm migration `049-deduplicate-active-skill-packages` is recorded in `schema_migrations`.

- [ ] **Step 3: Verify active catalog data**

Run a SQLite query grouping active Packages by logical identity. Expected: 58 active records, no group with a count greater than one, and each retained ID is the latest row by `updated_at`, `created_at`, and `id`.