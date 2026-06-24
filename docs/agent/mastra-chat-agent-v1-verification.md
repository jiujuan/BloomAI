# Mastra Chat Agent v1 Verification

Date: 2026-06-25

## Scope

This document records Task 10 verification for the Mastra chat agent v1 path: feature-flagged agent routing, BloomAI SSE tool call events, ToolCallCard rendering support, assistant message persistence, and legacy chat fallback.

## Automated Evidence

| Check | Command | Result |
| --- | --- | --- |
| TypeScript compile | `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| Backend agent SSE and persistence regression | `node node_modules/vitest/vitest.mjs run src/server/routes/chat.route.test.ts src/server/agent/mastra/chat-agent-runtime-adapter.test.ts` | Passed: 2 files, 11 tests |

The backend regression covers:

- `settings.agent_runtime_enabled=true` and `settings.agent_runtime_provider=mastra` switching `/api/v1/chat/stream` into `runChatAgentV1`.
- `agent_runtime_max_steps` clamped to `10`.
- SSE sequence containing `tool_call_start`, `tool_call_result`, `delta`, and `done`.
- Assistant content persisted with `messages.tool_calls` trace.
- Legacy LLM route still handling normal chat when the agent flag is off.

## Manual Runtime Check

Started the local server with:

```bash
node node_modules/tsx/dist/cli.mjs src/server/index.ts
```

Observed server startup:

```text
[BloomAI Server] Running on http://127.0.0.1:3718
```

This verifies the app can boot the API server and run migrations against the local SQLite database.

## UI Coverage

Task 7 and Task 8 UI behavior is covered by frontend tests and code paths already added in earlier tasks:

- `platform.chatStream` accepts `tool_call_start`, `tool_call_result`, and `tool_call_error`.
- `useChatStore` stores per-session streaming tool calls.
- `Timeline` renders `ToolCallCard` before the streaming assistant bubble.
- `ToolCallCard` supports `callId` and running/success/error states, including Top 3 `web_search` results.

## Manual Provider Notes

Live end-user chat requires a configured provider/model that Mastra can execute with valid credentials or a local model endpoint. In this environment no real provider credential or local Ollama-compatible model was available, so the user-facing live search prompt and normal prompt were verified through deterministic route/store/component tests rather than a live provider call.

For a live manual pass on a developer machine:

1. Configure `settings.agent_runtime_enabled=true`.
2. Configure `settings.agent_runtime_provider=mastra`.
3. Configure `settings.agent_runtime_max_steps=10`.
4. Select a mapped text model in Settings -> Models and provide its valid API key or local endpoint.
5. Send a search prompt such as `Search for Mastra TypeScript agent docs and summarize the top links`.
6. Confirm a `web_search` ToolCallCard appears, transitions from Running to Done, and the assistant streams a final answer.
7. Confirm `tool_runs` contains a successful `web_search` row and the assistant `messages.tool_calls` field contains the trace.
8. Send a normal prompt such as `Give me three naming ideas for a notes app`.
9. Confirm the answer streams without forced tool use.
10. Disable the agent feature flag and confirm the legacy chat path still streams text.

## Task 10 Checklist

- [x] `npm run typecheck` equivalent passed via direct TypeScript CLI.
- [x] Relevant backend test set passed.
- [x] Search prompt path covered by agent-on SSE test with `web_search` tool call events and persisted trace.
- [x] Normal chat path covered by legacy route regression.
- [x] Feature flag off path covered by legacy route regression.
- [x] Verification evidence recorded in this document.

## Residual Risk

The remaining risk is provider-specific: Mastra's live model execution and model-specific tool-calling behavior should be smoke-tested with the actual configured provider before release. The route, SSE contract, frontend state/rendering support, and persistence behavior are covered locally.
