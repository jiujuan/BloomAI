# MCP Disabled-State Handling Design

## Context

When `MCP_CLIENT_ENABLED` is absent or not exactly `true`, the MCP client is intentionally fail-closed. The MCP Servers page currently discovers that state by requesting `GET /api/v1/mcp/servers`; the request then returns `409 MCP_DISABLED` and is logged by the server before the renderer switches to its disabled screen.

## Goal

Keep MCP disabled by default while allowing the renderer to determine the flag state without issuing a failing management-list request. Document the opt-in flag and give users an actionable disabled-state message.

## Design

1. Add an authenticated, read-only `GET /api/v1/mcp/status` endpoint. It returns only `{ enabled: boolean }` and remains available whether MCP is enabled or disabled.
2. Add a corresponding `McpService.getStatus()` method that reads the existing strict feature flag. It does not access repositories, server configuration, or secrets.
3. Make the MCP renderer store request status before requesting server data. If disabled, it clears MCP page data, marks `featureDisabled`, and returns without calling `GET /servers`.
4. Retain the existing `MCP_DISABLED` error fallback in the store for a configuration change between the status and list requests.
5. Update the disabled-page copy to tell administrators to set `MCP_CLIENT_ENABLED=true` in `.env` and restart BloomAI.
6. Add the flag to `.env.example` with the default `false` and explain that only the exact string `true` enables it.

## Non-goals

- Changing the fail-closed default.
- Enabling MCP automatically.
- Returning MCP server configuration, tools, or secrets from the status endpoint.
- Changing the existing management authorization requirement.

## Acceptance criteria

- With MCP disabled, opening MCP Servers calls `/status` successfully and never calls `/servers`.
- The page renders an actionable disabled screen and hides management controls.
- `/status` reports the correct enabled state for both flag values.
- `.env.example` documents the opt-in flag.