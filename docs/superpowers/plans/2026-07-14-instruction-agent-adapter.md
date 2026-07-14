# Instruction Agent Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one installed `instruction-agent` SkillVersion through a bounded, persistent, capability-scoped Agent adapter.

**Architecture:** `InstructionAgentAdapter` loads only the selected run's immutable SkillVersion and its entry through `SkillPackageReader`, then passes a narrow `InstructionAgentExecutionContext` to an injected Agent executor. The context exposes the entry, manifest, bounded package reads, and a capability broker function limited to capabilities declared in that manifest. The adapter owns run-state transitions, events, token/step limits, cancellation observation, and normalized final output; it does not give the executor paths, repositories, or direct tool access.

**Tech Stack:** TypeScript, Zod, Vitest, SQLite repositories, `SkillRunCoordinator`, `SkillPackageReader`, Capability Broker.

---

## File Structure

- Create: `src/server/skills/adapters/instruction-agent-adapter.ts` - execution port, constrained context, lifecycle orchestration, limits and errors.
- Create: `src/server/skills/adapters/instruction-agent-adapter.test.ts` - isolated package/database tests using a fake executor.
- Modify: `src/server/skills/adapters/index.ts` - export Adapter public API.
- Modify: `src/server/skills/runtime/skill-run-coordinator.ts` - preserve approval capability names in the existing `approval.required` event.
- Modify: `src/server/skills/runtime/skill-run-coordinator.test.ts` - cover approval capability event payload.
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md` - complete only TODO 11 checkboxes after all behavior is present and verified.

### Task 1: Define the bounded execution contract

- [ ] **Step 1: Write failing tests** for a fake Agent executor receiving exactly one selected version's entry, parsed manifest, run input/context, `maxSteps`, `maxTokens`, controlled package read functions, and only the manifest-declared capability names.
- [ ] **Step 2: Run the focused test** with `npm test -- src/server/skills/adapters/instruction-agent-adapter.test.ts`; it must fail because the Adapter does not exist.
- [ ] **Step 3: Implement** `InstructionAgentAdapter`, its constructor dependencies, `run(runId)`, `InstructionAgentExecutor`, and a Zod-normalized execution result contract. Read `SKILL.md` only through `SkillPackageReader`; parse persisted manifest JSON; reject missing, incompatible, or non-`instruction-agent` versions before starting execution.
- [ ] **Step 4: Re-run focused tests** and confirm contract tests pass.

### Task 2: Add controlled reads, capabilities, and budgets

- [ ] **Step 1: Write failing tests** proving references are absent until the executor calls its controlled reader, package assets/references cannot escape the reader, undeclared capabilities are rejected before reaching the broker, step-count overflow fails without completing the run, and token-budget overflow fails without completing the run.
- [ ] **Step 2: Run the focused test** and confirm each new case fails for the missing behavior.
- [ ] **Step 3: Implement** per-run step and token accounting, manifest capability filtering, and a broker-only `executeCapability` wrapper that always sends `caller: 'package-runtime'`, the run ID, and the run session ID. Append only allowed existing event types (`package.file_loaded`, `step.started`, `step.completed`) with redacted metadata.
- [ ] **Step 4: Re-run focused tests** and confirm safe reads, whitelist enforcement, events, and both budgets pass.

### Task 3: Persist waiting, cancellation, and result states

- [ ] **Step 1: Write failing tests** for executor results that request user input or capability approval, a cancellation requested before and during execution, and a completed result normalized to a JSON-object run output.
- [ ] **Step 2: Run focused tests** and verify failures.
- [ ] **Step 3: Implement** state transitions through `SkillRunCoordinator` only: `validating -> running`, waiting results to `waiting_input`/`waiting_approval`, cancellation to `cancelled`, successful execution to `completed`, and unexpected errors to `failed`. Add approval capability names to `SkillRunCoordinator.transition()` data and its existing approval event payload.
- [ ] **Step 4: Re-run adapter and coordinator tests** and confirm all lifecycle tests pass.

### Task 4: Documentation and comprehensive verification

- [ ] **Step 1: Export** the Adapter and public types, then mark only TODO 11 items complete.
- [ ] **Step 2: Run focused verification:**
  `npm test -- src/server/skills/adapters/instruction-agent-adapter.test.ts src/server/skills/runtime/skill-run-coordinator.test.ts src/server/skills/packages/package-reader.test.ts src/server/skills/policy/capability-broker.test.ts`
- [ ] **Step 3: Run static checks:** `npm run typecheck`, `npm run build`.
- [ ] **Step 4: Run regression checks:** `npm test`, `git diff --check`. If the known parallel LLM timeout occurs, rerun `npm test -- src/server/llm/llm-runtime.integration.test.ts` separately and report both outcomes.

## Coverage Review

- Selected immutable SkillVersion and entry-only loading: Task 1.
- No cross-package context, on-demand references, and capability isolation: Task 2.
- Step/token limits, user input, approval, cancellation, and normalized output: Tasks 2 and 3.
- Event/state persistence, exports, TODO bookkeeping, and full regression evidence: Tasks 3 and 4.
