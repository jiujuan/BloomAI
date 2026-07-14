# Skill Run Event Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a stable, versioned and redacted event protocol for Skill Package Runs.

**Architecture:** A new runtime event module owns the discriminated union, payload schemas, redaction and payload-size guard. `skillPackageRepo` validates every event at the persistence boundary, so state-machine, capability broker and future adapters receive identical protection. Persisted run state remains the source of truth; events are only a replayable audit stream.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, SQLite, Vitest.

---

## File Structure

- Create: `src/server/skills/runtime/skill-run-events.ts` - Stable event union, schema version, redaction and payload guard.
- Create: `src/server/skills/runtime/skill-run-events.test.ts` - Unit tests for accepted events, redaction, large text and Base64 rejection.
- Modify: `src/server/db/repositories/skill-package.repo.ts` - Validate and sanitize event payloads before each insert.
- Modify: `src/server/skills/runtime/skill-run-coordinator.ts` - Emit typed run lifecycle, command and completion events.
- Modify: `src/server/skills/policy/capability-broker.ts` - Emit the stable capability-call event.
- Modify: `src/server/skills/runtime/index.ts` - Export the public protocol types.
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md` - Mark TODO 09 complete.

### Task 1: Define the Stable Event Protocol

**Files:**
- Create: `src/server/skills/runtime/skill-run-events.ts`
- Test: `src/server/skills/runtime/skill-run-events.test.ts`

- [ ] **Step 1: Write failing protocol tests**

```ts
it('redacts nested credentials while retaining an allowed file-load summary', () => {
  expect(normalizeSkillRunEvent({
    type: 'package.file_loaded',
    payload: { path: 'references/style.md', sha256: 'abc', sizeBytes: 24, apiKey: 'secret' },
  }).payload).toEqual({
    path: 'references/style.md', sha256: 'abc', sizeBytes: 24, apiKey: '[REDACTED]',
  })
})

it('rejects a base64 image payload and oversized text payload', () => {
  expect(() => normalizeSkillRunEvent({ type: 'step.completed', payload: { title: 'render', output: 'data:image/png;base64,AAAA' } })).toThrow()
  expect(() => normalizeSkillRunEvent({ type: 'step.completed', payload: { title: 'render', summary: 'x'.repeat(8_193) } })).toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/server/skills/runtime/skill-run-events.test.ts`

Expected: FAIL because `skill-run-events` does not exist.

- [ ] **Step 3: Implement event schemas and normalization**

```ts
export const skillRunEventSchemaVersion = 1

export const skillRunEventInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.status_changed'), payload: z.object({ from: z.string(), to: z.string(), revision: z.number().int() }) }),
  z.object({ type: z.literal('input.summarized'), payload: z.object({ keys: z.array(z.string()), byteLength: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal('package.file_loaded'), payload: z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }).passthrough() }),
  z.object({ type: z.literal('step.started'), payload: z.object({ title: z.string().max(512) }) }),
  z.object({ type: z.literal('step.completed'), payload: z.object({ title: z.string().max(512) }).passthrough() }),
  z.object({ type: z.literal('capability.call'), payload: z.object({ capability: z.string(), toolId: z.string(), toolRunId: z.string(), status: z.enum(['completed', 'failed']) }).passthrough() }),
  z.object({ type: z.literal('approval.required'), payload: z.object({ reason: z.string().max(2_000), capabilities: z.array(z.string()) }) }),
  z.object({ type: z.literal('artifact.created'), payload: z.object({ artifactId: z.string(), kind: z.string(), path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal('run.completed'), payload: z.object({ revision: z.number().int() }) }),
  z.object({ type: z.literal('run.completed_with_errors'), payload: z.object({ revision: z.number().int() }) }),
  z.object({ type: z.literal('run.failed'), payload: z.object({ code: z.string(), message: z.string().max(2_000), revision: z.number().int() }) }),
])
```

The implementation must recursively replace values for keys matching `authorization`, `apiKey`, `api_key`, `token`, `secret`, `password`, and reject `data:*;base64,` strings and serialized payloads over 8 KiB. No full input, output, file body or Base64 media is permitted.

- [ ] **Step 4: Run protocol tests to verify they pass**

Run: `npm test -- src/server/skills/runtime/skill-run-events.test.ts`

Expected: PASS.

### Task 2: Enforce the Protocol at the Repository Boundary

**Files:**
- Modify: `src/server/db/repositories/skill-package.repo.ts`
- Test: `src/server/skills/runtime/skill-run-events.test.ts`

- [ ] **Step 1: Add failing persistence-boundary tests**

```ts
it('never persists credentials or unbounded payloads through appendEvent', async () => {
  const { skillPackageRepo, run } = await createRunFixture()
  skillPackageRepo.appendEvent({
    runId: run.id,
    seq: 1,
    type: 'step.completed',
    payload: { title: 'fetch', authorization: 'Bearer private-token' },
  })

  expect(skillPackageRepo.listEvents(run.id)[0].payload_json).toContain('[REDACTED]')
  expect(() => skillPackageRepo.appendEvent({
    runId: run.id, seq: 2, type: 'step.completed', payload: { title: 'fetch', raw: 'x'.repeat(8_193) },
  })).toThrow(/payload/i)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/server/skills/runtime/skill-run-events.test.ts`

Expected: FAIL because repository insertions currently serialize raw objects.

- [ ] **Step 3: Normalize every event before INSERT**

```ts
const event = normalizeSkillRunEvent({ type: data.type, payload: data.payload })

tx.insert(skill_run_events).values({
  schema_version: event.schemaVersion,
  type: event.type,
  payload_json: JSON.stringify(event.payload),
  // existing id/run/seq/timestamp fields
})
```

Apply the same helper inside both `applyRunChange()` and `appendEvent()`. Preserve each caller-provided `seq`; only protocol schema version and sanitized payload are derived.

- [ ] **Step 4: Run protocol and repository tests to verify they pass**

Run: `npm test -- src/server/skills/runtime/skill-run-events.test.ts src/server/db/repositories/skill-package.repo.test.ts`

Expected: PASS.

### Task 3: Migrate Runtime and Capability Emitters

**Files:**
- Modify: `src/server/skills/runtime/skill-run-coordinator.ts`
- Modify: `src/server/skills/policy/capability-broker.ts`
- Modify: `src/server/skills/runtime/index.ts`
- Test: `src/server/skills/runtime/skill-run-coordinator.test.ts`
- Test: `src/server/skills/policy/capability-broker.test.ts`

- [ ] **Step 1: Add failing integration assertions for stable event names**

```ts
expect(coordinator.subscribeEvents(runId)[0]).toMatchObject({
  schemaVersion: 1,
  type: 'run.status_changed',
  payload: { from: 'created', to: 'validating', revision: 1 },
})

expect(JSON.parse(skillPackageRepo.listEvents(run.id)[0].payload_json)).toMatchObject({
  capability: 'web.fetch', toolId: 'web_fetch', status: 'completed', toolRunId: expect.any(String),
})
```

- [ ] **Step 2: Run affected tests to verify they fail**

Run: `npm test -- src/server/skills/runtime/skill-run-coordinator.test.ts src/server/skills/policy/capability-broker.test.ts`

Expected: FAIL because current runtime events use ad hoc names such as `run.running`.

- [ ] **Step 3: Emit only stable protocol event names**

Use `run.status_changed` for non-terminal transitions, `run.completed` and `run.completed_with_errors` for terminal success states, and `run.failed` with `{ code, message, revision }` for failure. Keep broker event type `capability.call`, but do not include tool input/output. Export `SkillRunEventInput` and `SkillRunEventType` from `runtime/index.ts`.

- [ ] **Step 4: Run affected tests to verify they pass**

Run: `npm test -- src/server/skills/runtime/skill-run-coordinator.test.ts src/server/skills/policy/capability-broker.test.ts`

Expected: PASS.

### Task 4: Complete Documentation and Verification

**Files:**
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md`

- [ ] **Step 1: Mark all TODO 09 checklist items complete**

Change only the TODO 09 checkboxes to `[x]` after every protocol requirement is covered by implementation and tests.

- [ ] **Step 2: Run scoped regression and static verification**

Run: `npm test -- src/server/skills/runtime/skill-run-events.test.ts src/server/skills/runtime/skill-run-coordinator.test.ts src/server/skills/policy/capability-broker.test.ts src/server/db/repositories/skill-package.repo.test.ts`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: both commands exit 0.

- [ ] **Step 3: Run full suite and diff checks**

Run: `npm test`

Expected: PASS; if the known intermittent LLM integration timeout recurs, immediately run `npm test -- src/server/llm/llm-runtime.integration.test.ts` and report both results.

Run: `git diff --check`

Expected: no whitespace errors.

## Coverage Review

- Stable discriminated union, `seq` and schema version: Task 1 and Task 2.
- Input summary, file-load, step, capability, approval, artifact, completion, partial-completion and failure events: Task 1 and Task 3.
- Secret redaction, artifact-only handling for large content, and Base64/media exclusion: Task 1 and Task 2.
- Single-event payload cap: Task 1 and Task 2.
- Runtime integration and regression checks: Task 3 and Task 4.
