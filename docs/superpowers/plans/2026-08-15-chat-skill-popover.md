# Chat Skill Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Chat composer Package Skill select with a searchable, paginated skill-card popover and removable selected-skill chip.

**Architecture:** Keep `ChatPanelMastra` as the session-aware owner of the eligible-skill list and selected version ID. Extract popover presentation and client-side filtering/paging into `ChatSkillPicker`, which has no server dependencies and reports selection to the parent through callbacks.

**Tech Stack:** React, TypeScript, lucide-react, Vitest, existing global CSS tokens.

---

## File structure

- Create: `src/renderer/pages/Chat/ChatSkillPicker.tsx` — accessible toolbar trigger, popover cards, search, paging, selected chip, pure display helpers.
- Create: `src/renderer/pages/Chat/ChatSkillPicker.test.ts` — unit coverage of name cleanup, filtering, and 20-item page boundaries.
- Modify: `src/renderer/pages/Chat/ChatPanelMastra.tsx` — replace the native `<select>` with the new controlled picker.
- Modify: `src/renderer/styles/global.css` — composer-local popup, card, paging, and selected-chip styles.

### Task 1: Define pure selection presentation behavior with tests

- [ ] Add failing tests for `skillDisplayName` to remove a trailing ` · v<version>` suffix without changing names that do not contain one.
- [ ] Add failing tests for case-insensitive name/description filtering and matching no skill when both fields do not include the query.
- [ ] Add failing tests for pagination: exactly 20 skills on the first page and remaining skills on the second page.
- [ ] Run `npx vitest run src/renderer/pages/Chat/ChatSkillPicker.test.ts --pool=forks --maxWorkers=1 --minWorkers=1` and confirm the expected missing-module failure.
- [ ] Implement the exported helpers in `ChatSkillPicker.tsx`.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Implement the controlled skill popover

- [ ] Build the `技能` trigger, search field, card list, empty state, page controls, outside-click dismissal, and Escape dismissal in `ChatSkillPicker.tsx`.
- [ ] Render the selected skill as an info-colored, bold chip containing an accessible remove button.
- [ ] Make card activation invoke `onSelect(skillVersionId)` and close the popover; make removal invoke `onRemove()`.
- [ ] Replace lines 830–845 of `ChatPanelMastra.tsx` with the controlled picker, passing existing `chatSkills`, `selectedChatSkillVersionId`, `setSelectedChatSkillVersionId`, and current send-disabled state.

### Task 3: Style and verify

- [ ] Add popover/card/pagination/chip rules in `src/renderer/styles/global.css`, anchored above the composer toolbar and using existing color variables.
- [ ] Run the focused picker tests.
- [ ] Run `npm run typecheck`.
- [ ] Inspect `git diff --check` and the final diff; report any verification limitation accurately.