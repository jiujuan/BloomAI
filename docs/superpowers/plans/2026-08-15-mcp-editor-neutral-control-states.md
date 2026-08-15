# MCP Editor Neutral Control States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep MCP Add server form controls visually neutral during hover and focus.

**Architecture:** Add a narrowly scoped CSS selector after the MCP field base rule, so its state declarations override global browser or form-control focus treatments without affecting other pages.

**Tech Stack:** CSS, Vitest.

---

## File structure

- Create: `src/renderer/pages/McpServers/mcp-servers.styles.test.ts` — verify neutral MCP control-state declarations.
- Modify: `src/renderer/styles/global.css` — neutral hover/focus/active styling for `.mcp-field` controls.

### Task 1: Lock the neutral control-state contract

- [ ] Add a failing stylesheet test that reads `global.css` and expects the MCP input, select, and textarea hover/focus/focus-visible/active selector group.
- [ ] Run `npm run test:mcp-ui` and confirm the expected selector assertion fails.
- [ ] Add the MCP-specific selector group with `border-color: var(--border-secondary)`, `background: var(--bg-primary)`, `box-shadow: none`, and `outline: none`.
- [ ] Re-run `npm run test:mcp-ui`, `npm run typecheck`, and `git diff --check`.