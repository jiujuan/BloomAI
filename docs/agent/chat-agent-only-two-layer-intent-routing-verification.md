# Chat Agent-Only Two-Layer Intent Routing Verification

## Status

Accepted for Task 18 closeout on 2026-06-28.

The chat stream path is agent-only. Backend route handling enters `streamChatAgentRoute`, Mastra runtime emits v1 response events, and the renderer consumes v1 `ResponseStreamEvent` blocks through the store and Timeline. There is no active direct LLM fallback for chat responses.

## Implementation Decisions

- `chat.route.ts` owns HTTP/SSE, session validation, message persistence, organized prompt construction, model selection, and runtime max step configuration.
- `chat-agent-router.ts` is the route-to-agent boundary and forwards complete prompt context into `runChatAgentV1`.
- Intent routing is internal to the agent runtime: programmatic detector first, LLM classifier only for low-confidence decisions.
- `answer_only` means the Mastra agent answers with the selected model and no injected tools. It is not a direct route fallback.
- Tool and skill activity is represented as ordinary v1 tool call blocks. Skills use `toolId: skill:<skillId>` and `category: tool`, then render through `ToolCallGroupCard` with no skill-specific UI.
- Agent failures emit v1 `response_failed` events. The frontend renders them through `TimelineErrorBlock`; it does not show a fallback answer.

## Legacy Trace Compatibility

`direct-llm` remains valid only in shared schemas so old persisted v1 traces can still parse and old conversations can load. New active responses default to `mastra-chat-agent-v1` in `chat-response-stream.ts` unless an explicit legacy trace is being replayed.

Do not remove this shared compatibility type without a separate data migration. Do not use it as an active chat runtime.

## Verification Commands

### Focused Backend Tests

```text
node node_modules/vitest/vitest.mjs run src/server/routes/chat.route.test.ts src/server/routes/chat-response-stream.test.ts src/server/agent/mastra src/server/agent/runtime/intent
```

Result: 12 test files passed, 91 tests passed.

Coverage highlights:

- No-tool agent answer and persistence.
- Programmatic web search/tool path.
- Skill tool path with `skill:<skillId>` trace.
- Intent classifier fallback to safe `answer_only`.
- Agent startup/runtime failures emit `response_failed` without direct LLM fallback.
- Empty agent stream completes without direct LLM fallback.

### Focused Frontend Tests

```text
node node_modules/vitest/vitest.mjs run src/renderer/api src/renderer/store src/renderer/pages/Chat
```

Result: 8 test files passed, 52 tests passed.

Coverage highlights:

- API yields v1 SSE events without legacy normalization.
- Store reduces v1 events into `streamingResponsesBySession` blocks.
- Timeline renders markdown, wait state, tool groups, and error blocks from v1 blocks.
- Skill calls render as ordinary grouped tool calls.

### Shared Schema Tests

```text
node node_modules/vitest/vitest.mjs run src/shared/schemas/response.test.ts
```

Result: 1 test file passed, 10 tests passed.

Coverage highlights:

- v1 response stream schema accepts active agent runtime events.
- `direct-llm` remains parseable only for legacy response compatibility.

### Typecheck

```text
npm run typecheck
```

Result: exit 0. `tsc --noEmit` completed successfully.

### Build

```text
npm run build
```

Result: exit 0. `tsc --noEmit` and Vite production builds completed successfully.

Build output included renderer bundle plus Electron main/preload bundles.

## `rg` Evidence

```text
rg streamLegacyChat src
```

Result: no matches.

```text
rg createChatStreamNormalizer src
```

Result: no matches.

```text
rg direct-llm src/server src/shared src/renderer
```

Result: matches only shared schema/test compatibility and the `chat-response-stream.ts` comment documenting that active responses default to `mastra-chat-agent-v1`.

Observed matches:

- `src/shared/schemas/response.ts`: keeps `direct-llm` in `ResponseRuntime` for old saved traces.
- `src/shared/schemas/response.test.ts`: verifies legacy response compatibility.
- `src/shared/schemas/message-trace.test.ts`: verifies old direct trace parsing and invalid trace rejection.
- `src/server/routes/chat-response-stream.ts`: documents that active responses default to agent runtime and direct-llm is accepted only for explicit legacy traces.

No active chat route direct LLM runtime remains.

## Guardrails For Future Work

- Do not add a second chat answer path under `chat.route.ts`.
- Do not reintroduce renderer legacy stream normalizers or `streamingText` as active state.
- Do not create skill-specific Timeline UI for ordinary skill calls; keep them as grouped tool calls.
- Keep provider-level stream capabilities separate from chat route runtime selection.
- Preserve old trace compatibility until a dedicated migration removes it.