# Image Studio Capability Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run article-illustration image generation through Image Studio sessions and persistent image-generation records, with linked Skill Run artifacts and correct batch outcomes.

**Architecture:** `ImageStudioCapabilityAdapter` owns one Skill Run's image batch. It creates or reuses an `image_session`, invokes existing `generateForSession()` with at most two active requests, writes prompt and image-reference artifacts, and emits a Markdown illustration list. It returns a normalized batch result for Run transitions to `completed` or `completed_with_errors`; existing Image Studio routes remain unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, SQLite repositories, `generateForSession()`, `ArtifactStore`, `SkillRunCoordinator`.

---

## File Structure

- Create: `src/server/skills/adapters/image-studio-capability-adapter.ts` - input/result contracts, batch queue, session ownership, retry/skip/cancel, artifacts.
- Create: `src/server/skills/adapters/image-studio-capability-adapter.test.ts` - isolated persistence and lifecycle tests.
- Modify: `src/server/skills/adapters/index.ts` - export the adapter API.
- Modify: `src/server/skills/policy/capability-broker.ts` - route Package Runtime `image.generate` through the adapter boundary.
- Modify: `src/server/skills/adapters/instruction-agent-adapter.ts` - permit `completed_with_errors` results.
- Modify: `src/server/skills/adapters/instruction-agent-adapter.test.ts` - test the partial completion transition.
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md` - mark only delivered TODO 12 checks.

### Task 1: Contract and Persistence

- [ ] Write failing adapter tests for two prompts: create a missing Image Studio session, call `generateForSession()` per prompt, retain `image_generations` records, and create linked prompt/image-reference Artifacts containing each generation ID.
- [ ] Run `npm test -- src/server/skills/adapters/image-studio-capability-adapter.test.ts`; verify RED because the adapter does not exist.
- [ ] Implement Zod input validation, session creation/reuse, generation delegation, and deterministic safe Artifact filenames.
- [ ] Re-run the focused test; verify GREEN.

### Task 2: Bounded Batch and Outcome

- [ ] Write failing tests for three items at concurrency `2`, independent failed/successful item states, an `illustrations.md` Artifact, and aggregate `completed_with_errors` when a requested item fails.
- [ ] Run the focused test and confirm the expected RED failures.
- [ ] Implement a two-worker queue and item states: `pending`, `running`, `completed`, `failed`, `skipped`, `cancelled`. Return `completed` only when all requested images complete; return `completed_with_errors` for partial success.
- [ ] Re-run focused tests and verify at most two active generations.

### Task 3: Per-Image Controls

- [ ] Write failing tests for original-prompt retry, edited-prompt retry, skipped failed items, and group cancellation stopping queued work.
- [ ] Run the focused test and confirm the expected RED failures.
- [ ] Implement `retryItem`, `skipItem`, and cancellation checks before every queued request. Retries preserve model/options and create new generation/reference records.
- [ ] Re-run focused tests and verify the item states and records.

### Task 4: Runtime Integration and Acceptance

- [ ] Write failing tests that Package Runtime `image.generate` delegates through the adapter instead of `executeToolInternal('image_gen', ...)`, and that an executor can transition a Run to `completed_with_errors`.
- [ ] Run focused Adapter, Instruction Agent, and Broker tests and confirm RED.
- [ ] Implement broker delegation, normalized capability output, execution-result support, adapter exports, and TODO bookkeeping.
- [ ] Run acceptance: focused tests, `npm run typecheck`, `npm run build`, `npm test`, and `git diff --check`.

## Coverage Review

- Session creation/reuse, image-generation records, and Generation ID Artifacts: Task 1.
- Concurrency, per-image result state, Markdown manifest, and partial result: Task 2.
- Retry, edited prompt retry, skip, and group cancellation: Task 3.
- Broker integration and persistent `completed_with_errors`: Task 4.
