# MCP Disabled-State Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the MCP Servers page from generating an expected `409 MCP_DISABLED` request while retaining the MCP client’s fail-closed default.

**Architecture:** Expose a minimal, admin-protected MCP status read through the existing Route → Service boundary. The renderer store asks for the status before listing servers and exits into the existing disabled state when `enabled` is false.

**Tech Stack:** TypeScript, Hono, React, Zustand, Vitest.

---

## File structure

- Modify: `src/server/mcp/mcp.service.ts` — expose a secret-free enabled-state read.
- Modify: `src/server/http/routes/mcp.ts` — add `GET /status` through `McpService`.
- Modify: `src/server/http/routes/mcp.test.ts` — verify enabled and disabled status responses.
- Modify: `src/renderer/pages/McpServers/mcp-servers.api.ts` — request the status envelope.
- Modify: `src/renderer/pages/McpServers/mcp-servers.store.ts` — gate `listServers()` behind the status read.
- Modify: `src/renderer/pages/McpServers/mcp-servers.store.test.ts` — prove disabled status prevents a server-list request.
- Modify: `src/renderer/pages/McpServers/index.tsx` — show exact opt-in and restart instructions.
- Modify: `src/renderer/pages/McpServers/mcp-servers.ui.test.tsx` — assert that instruction is rendered.
- Modify: `.env.example` — document `MCP_CLIENT_ENABLED=false` as the secure default.

### Task 1: Define and expose feature status

- [ ] Add a failing route test using `createService({ enabled: false })` that requests `/api/v1/mcp/status` as an admin and expects `200` with `{ data: { enabled: false } }`.
- [ ] Run `npm run test:mcp-http` and confirm the new expectation fails because `/status` is not registered.
- [ ] Add `getStatus(): { enabled: boolean }` to `McpService`, returning `isMcpClientEnabled(this.env)` without calling `assertEnabled()`.
- [ ] Add an admin-protected `routes.get('/status', ...)` handler that returns `{ data: service.getStatus() }`.
- [ ] Re-run `npm run test:mcp-http` and confirm it passes.

### Task 2: Gate MCP page loading before the list request

- [ ] Add `getStatus` to `McpServersApi`, import the API function, and put it in `defaultApi`.
- [ ] Add a failing store test with mocked `getStatus: vi.fn().mockResolvedValue({ enabled: false })` and `listServers: vi.fn()`. Call `loadServers()` and assert `featureDisabled` is true, `error` is null, and `listServers` was not called.
- [ ] Run `npm run test:mcp-ui` and confirm the new store test fails because status is not requested.
- [ ] Add `getMcpStatus()` to the API module using `request<{ enabled: boolean }>('/status')`.
- [ ] Update `loadServers()` to request `getStatus()` first. When disabled, clear displayed MCP data, set `featureDisabled: true`, clear the loading/busy states, and return before `listServers()`.
- [ ] Keep the existing `MCP_DISABLED` catch behavior for a race after a successful enabled-status response.
- [ ] Re-run `npm run test:mcp-ui` and confirm it passes.

### Task 3: Document and render remediation guidance

- [ ] Add a failing UI assertion that disabled markup includes `MCP_CLIENT_ENABLED=true` and a restart instruction.
- [ ] Run `npm run test:mcp-ui` and confirm the new assertion fails.
- [ ] Replace the disabled-state paragraph with explicit `.env` opt-in and restart instructions, retaining the no-controls behavior.
- [ ] Add a commented MCP section to `.env.example` with `MCP_CLIENT_ENABLED=false` and the exact-`true` rule.
- [ ] Re-run `npm run test:mcp-ui`, `npm run test:mcp-http`, `npm run typecheck`, and `git diff --check`.