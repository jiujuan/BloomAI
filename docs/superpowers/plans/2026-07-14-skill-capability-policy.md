# Skill Capability Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add version-bound capability grants with scoped permissions, expiration, one-time/session consumption, image budgets, and safe upgrade inheritance rules.

**Architecture:** `src/server/skills/policy/capability-policy.ts` owns the typed capability vocabulary and scope validation. The repository persists and queries grants; `CapabilityBroker` delegates all package grant decisions to the policy module, preserving its role as the sole execution boundary.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, SQLite migrations, Vitest.

---

### Task 1: Define Capability Policy Contract

**Files:**
- Create: `src/server/skills/policy/capability-policy.ts`
- Create: `src/server/skills/policy/capability-policy.test.ts`

- [ ] Write failing tests for valid capabilities, `once/session/persistent` modes, and invalid scopes.
- [ ] Run `npx vitest run src/server/skills/policy/capability-policy.test.ts` and confirm it fails because the module is absent.
- [ ] Implement the Zod-backed `SkillCapability`, grant mode, and scope schemas.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Persist Scoped Grant State

**Files:**
- Create: `scripts/migrations/005-skill-capability-grant-state.sql`
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/repositories/skill-package.repo.ts`
- Modify: `src/server/db/migrations.test.ts`

- [ ] Write failing tests for `session_id`, `consumed_at`, deterministic grant lookup, and revocation.
- [ ] Run the migration/repository tests and confirm the new API fails.
- [ ] Add migration and repository methods without changing legacy tables.
- [ ] Re-run focused tests and confirm they pass.

### Task 3: Enforce Scope and Grant Lifetime in Broker

**Files:**
- Modify: `src/server/skills/policy/capability-broker.ts`
- Modify: `src/server/skills/policy/capability-broker.test.ts`

- [ ] Write failing Broker tests for expiry, once consumption, session binding, URL domain allowlists, uploaded file roots, and image allowlist/budget.
- [ ] Run the Broker test and confirm the unsupported policy cases fail.
- [ ] Delegate grant resolution and consumption to the policy/repository boundary.
- [ ] Re-run the Broker test and confirm it passes.

### Task 4: Add Safe Upgrade Permission Diffs

**Files:**
- Modify: `src/server/skills/policy/capability-policy.ts`
- Modify: `src/server/skills/policy/capability-policy.test.ts`
- Modify: `src/server/db/repositories/skill-package.repo.ts`

- [ ] Write failing tests that compare old/new requested permissions, allow equal-or-narrower scopes to inherit, and revoke inheritance for new or broadened permissions.
- [ ] Run policy tests and confirm upgrade-diff expectations fail.
- [ ] Implement the diff and inheritance candidates, binding every inherited grant to the new `skill_version_id`.
- [ ] Re-run policy tests and confirm they pass.

### Task 5: Acceptance

**Files:**
- Modify: `vitest.config.ts` only if test execution exposes a repeatable timeout issue.

- [ ] Run `npx vitest run src/server/skills/policy/capability-policy.test.ts src/server/skills/policy/capability-broker.test.ts src/server/db/repositories/skill-package.repo.test.ts src/server/db/migrations.test.ts`.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Stage only TODO 04 files; do not stage user-owned `src/server/http/routes/chat.ts`, `src/server/http/routes/chat-plan.test.ts`, `.claude/`, or untracked docs.
