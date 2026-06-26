# LLM Response Contract v1 Event Timeline Verification

## Scope

- Date: 2026-06-27
- Scope: Task 13 end-to-end acceptance evidence for the v1 response event contract, renderer normalizer, streaming reducer, Timeline rendering, error/log mapping, web search fallback display, and persistence failure handling.
- Boundary: This document records verification evidence only. It does not add business logic, change event behavior, or commit temporary screenshots/logs.
- Related table: [llm-response-contract-v1-event-timeline-table.md](./llm-response-contract-v1-event-timeline-table.md)

## Automated Verification

| Command | Result | Evidence |
|---|---:|---|
| `npm test -- src/shared/schemas/response.test.ts src/shared/llm-response-contract/registry.test.ts` | Passed | 2 test files passed, 13 tests passed. |
| `npm test -- src/server/llm/response-event-mapper.test.ts src/server/agent/mastra/response-event-mapper.test.ts src/server/routes/chat-response-stream.test.ts src/server/routes/chat.route.test.ts` | Passed | 4 test files passed, 34 tests passed. Covers direct LLM mapper failures/abort, agent tool/fallback/error flows, response stream accumulation, route logging, and persistence failure behavior. |
| `npm test -- src/renderer/api/chat-stream-normalizer.test.ts src/renderer/store/chat-response-reducer.test.ts src/renderer/store/index.test.ts` | Passed | 3 test files passed, 21 tests passed. |
| `npm test -- src/renderer/pages/Chat/Timeline.test.tsx src/renderer/pages/Chat/ToolCallGroupCard.test.tsx src/renderer/pages/Chat/ToolCallCard.test.tsx` | Passed | 3 test files passed, 20 tests passed. |
| `npm run build` | Passed | `tsc --noEmit`, Vite renderer build, and Electron build completed. |

## Verification Status

Task 13 acceptance is verified by the automated suites listed above plus the scenario evidence matrix below. The previous server mapper test-mock gap was resolved by adding the missing `sanitizeErrorMessage` export to the local Vitest logger mock in `src/server/llm/response-event-mapper.test.ts`.

Key acceptance checks:

- Fallback status is preserved and rendered in the same `web_search` tool group.
- Persistence failure after `response_completed` writes a log and does not emit a second terminal event.
- All required automated test commands pass.
- All 12 end-to-end scenarios have mapped verification evidence.
- The event timeline table links to this verification document.

## Unified Acceptance Checklist

| Area | Acceptance signal | Automated evidence | Manual evidence required |
|---|---|---|---|
| Contract schemas | v1 `ResponseStreamEvent` accepts known events and rejects malformed/unknown events. | `src/shared/schemas/response.test.ts` passed. | Optional real SSE malformed-chunk smoke. |
| Error registry | Known codes resolve to registry labels; unknown codes fall back to `UNKNOWN_ERROR`. | `src/shared/llm-response-contract/registry.test.ts` passed. | Optional real UI copy smoke for provider/tool/unknown errors. |
| Direct LLM mapper | Success, before-content failure, partial failure, and abort map to terminal v1 events. | `src/server/llm/response-event-mapper.test.ts` passed. | Optional real provider SSE sequence capture. |
| Agent mapper | Tool events, fallback status, and response terminal events map to v1. | `src/server/agent/mastra/response-event-mapper.test.ts` passed. | Optional real web search fallback smoke. |
| Stream writer | Response state writes content/tool/usage/error events and terminal event once. | `src/server/routes/chat-response-stream.test.ts` passed. | Optional route SSE capture. |
| Chat route | Route handles response, error, logging, fallback, and persistence failure paths. | `src/server/routes/chat.route.test.ts` passed. | Optional `LOG_DATA_DIR` file inspection in a real run. |
| Renderer normalizer | Legacy and v1 chunks normalize to unified `ResponseStreamEvent`; flush/abort are closed. | `src/renderer/api/chat-stream-normalizer.test.ts` passed. | Optional malformed legacy chunk smoke. |
| Store reducer | Streaming state tracks markdown, tool calls, usage, error, and legacy compatibility fields. | `src/renderer/store/chat-response-reducer.test.ts` and `src/renderer/store/index.test.ts` passed. | Optional store DevTools inspection. |
| Timeline UI | Timeline renders streaming blocks, grouped tools, errors, and waiting state without extra collapse depth. | `Timeline.test.tsx`, `ToolCallGroupCard.test.tsx`, and `ToolCallCard.test.tsx` passed. | Optional screenshot/DOM capture. |
| Persistence failure | Completed stream remains terminal, persistence exception is logged with diagnostic context. | `src/server/routes/chat.route.test.ts` passed. | Optional temp `LOG_DATA_DIR` inspection. |

## Key SSE Event Sequences

### Direct LLM Success

```text
response_started
-> content_block_started
-> content_delta...
-> usage_updated?
-> content_block_completed
-> response_completed
```

### Direct LLM Before-Content Failure

```text
response_started
-> response_failed(LLM_PROVIDER_ERROR | UNKNOWN_ERROR)
```

Expected Timeline state: readable error block, no empty assistant bubble.

### Direct LLM After-Partial Failure

```text
response_started
-> content_block_started
-> content_delta...
-> response_failed(LLM_PROVIDER_ERROR | UNKNOWN_ERROR)
```

Expected Timeline state: partial markdown remains visible and an error block is appended.

### Agent No-Tool Success

```text
response_started
-> content_block_started
-> content_delta...
-> content_block_completed
-> response_completed
```

### Agent Web Search Success

```text
response_started
-> tool_call_started(web_search)
-> tool_call_delta(query/status)
-> tool_call_completed(results summary)
-> content_block_started
-> content_delta...
-> content_block_completed
-> response_completed
```

### Web Search Fallback Success

```text
response_started
-> tool_call_started(web_search)
-> tool_call_delta(primary provider running)
-> tool_call_delta(primary provider failed, fallback running)
-> tool_call_completed(fallback results summary)
-> content_block_started
-> content_delta...
-> content_block_completed
-> response_completed
```

Expected Timeline state: one `web_search` group displays primary and fallback status messages.

### Tool Soft Failure + Agent Continue

```text
response_started
-> tool_call_started(web_search)
-> tool_call_failed(TOOL_CALL_ERROR)
-> content_block_started
-> content_delta...
-> content_block_completed
-> response_completed
```

Expected Timeline state: tool group is `partial_error` or `error`, while the response completes.

### Tool Hard Failure + Response Failed

```text
response_started
-> tool_call_started(required_tool)
-> tool_call_failed(TOOL_CALL_ERROR)
-> response_failed(TOOL_CALL_ERROR | AGENT_RUNTIME_ERROR)
```

### Agent Before-Visible Failure + Direct LLM Fallback

```text
agent runtime starts internally
-> agent fails before first visible v1 event
-> direct LLM fallback starts
-> response_started(runtime=direct-llm)
-> content_block_started
-> content_delta...
-> content_block_completed
-> response_completed
```

If any v1 event was already sent for the agent response, the stream must close with `response_failed` instead of silently switching `responseId`.

### Agent After-Visible Failure + Response Failed

```text
response_started
-> tool_call_started? / content_block_started?
-> tool_call_delta? / content_delta?
-> response_failed(AGENT_RUNTIME_ERROR)
```

Expected Timeline state: partial content/tool state remains visible; running tool calls are recognized as interrupted.

### Stream Aborted

```text
response_started
-> content_delta? / tool_call_started?
-> response_failed(STREAM_ABORTED)
```

Expected Timeline state: interruption message is visible and running tool groups are interrupted.

### Persistence Failure After Completed Stream

```text
response_started
-> ...
-> response_completed
-> persist assistant/tool trace/tokens fails after terminal event
-> log chat.persistence error
```

Expected stream behavior: no second terminal event is sent after `response_completed`.

## Manual Acceptance Matrix

| Scenario | Prompt/input | Expected SSE sequence | Timeline UI state | Assistant persistence | Tool trace persistence | Evidence |
|---|---|---|---|---|---|---|
| 1. Direct LLM success | Ask a simple non-tool question. | Direct LLM success sequence. | Final markdown answer, no tool card. | Assistant message saved with final text. | No tool trace or empty trace. | `src/server/llm/response-event-mapper.test.ts` maps delta/usage/done; `src/server/routes/chat.route.test.ts` persists response. |
| 2. Direct LLM before-content failure | Force provider failure before first token. | `response_started -> response_failed`. | Error block, no empty assistant bubble. | Product policy dependent: no assistant or error assistant only. | No tool trace. | `response-event-mapper.test.ts` before-content failure; `Timeline.test.tsx` no empty bubble; `chat.route.test.ts` visible error log. |
| 3. Direct LLM after-partial failure | Force provider failure after at least one delta. | Partial failure sequence. | Partial markdown plus error block. | Partial assistant retained if route policy persists partial content. | No tool trace. | `response-event-mapper.test.ts` stream throws after delta; `Timeline.test.tsx` partial answer plus error; `chat.route.test.ts` saves partial text. |
| 4. Agent no-tool success | Ask an agent-routed question that needs no tool. | Agent no-tool success sequence. | Final markdown answer, no tool card. | Assistant saved. | Agent trace without tool calls or empty tool calls. | `src/server/agent/mastra/response-event-mapper.test.ts` no-tool assistant deltas; route persistence tests. |
| 5. Agent web search success | Ask for current/search-dependent information. | Web search success sequence. | One `web_search` group plus final answer. | Assistant saved. | One successful `web_search` call saved. | `chat.route.test.ts` streams Mastra tool call SSE and persists tool calls; `Timeline.test.tsx` grouped web search card. |
| 6. Web search fallback success | Make primary search provider fail and fallback succeed. | Web search fallback success sequence. | One `web_search` group with fallback status. | Assistant saved. | One `web_search` call saved with fallback summary, not raw output. | `response-event-mapper.test.ts` adds query/fallback deltas to same call; `chat.route.test.ts` streams fallback status in same group; `ToolCallGroupCard.test.tsx` renders fallback stage. |
| 7. Tool soft failure + Agent continue | Make all search providers fail but let agent answer with limitations. | Soft failure continue sequence. | Failed/partial tool group plus completed answer. | Assistant saved with limitation text. | Failed tool call saved. | `response-event-mapper.test.ts` soft tool failure continues; `ToolCallGroupCard.test.tsx` partial error status. |
| 8. Tool hard failure + response failed | Make required tool fail and prevent continuation. | Hard failure sequence. | Tool error plus response error. | Partial/error assistant per route policy. | Failed tool call saved. | `response-event-mapper.test.ts` hard tool failure plus `response_failed`; `ToolCallCard.test.tsx` registry error display. |
| 9. Agent before-visible failure + Direct LLM fallback | Force agent init/planning failure before first visible event. | Fallback direct LLM sequence. | Direct LLM answer, no empty agent bubble. | Assistant saved from fallback response. | No agent tool trace. | `chat.route.test.ts` falls back to direct LLM when Mastra first reports an error. |
| 10. Agent after-visible failure + response failed | Force agent failure after content/tool event. | After-visible failure sequence. | Partial state plus error; running tools interrupted. | Partial assistant per route policy. | Started/running tool trace saved as failed/interrupted evidence where available. | `chat.route.test.ts` response_failed after visible tool/output; reducer marks running tools interrupted. |
| 11. Stream aborted | Cancel request or disconnect SSE. | Abort sequence with `STREAM_ABORTED`. | Interrupted state, partial content preserved. | No final assistant or partial assistant per route policy. | Running tool trace marked interrupted where available. | `response-event-mapper.test.ts` maps aborts; `chat-stream-normalizer.test.ts` maps abort/disconnect to `STREAM_ABORTED`. |
| 12. Persistence failure after completed stream | Mock assistant/tool/tokens persistence throw after `response_completed`. | Completed sequence only; persistence failure happens after terminal event. | Completed answer remains in temporary UI state until reload. | Save failed. | Trace/token save failed if included in mock. | `chat.route.test.ts` logs assistant persistence failure after `response_completed` and asserts there is no second terminal event. |

## UI DOM And Screenshot Evidence

Temporary screenshots are not committed. Automated DOM evidence is covered by Testing Library assertions:

| UI evidence | Source coverage |
|---|---|
| Response started with no blocks | `Timeline.test.tsx` covers lightweight waiting state and no blank assistant bubble. |
| Adjacent web search calls grouped | `Timeline.test.tsx` and `ToolCallGroupCard.test.tsx` cover adjacent same-key grouping. |
| Markdown cuts tool group | `Timeline.test.tsx` covers `web_search -> markdown -> web_search` as two groups. |
| Fallback status message | `ToolCallGroupCard.test.tsx` covers fallback `statusMessage` display in one group. |
| Partial answer plus error | `Timeline.test.tsx` covers response failure after content. |
| Tool error text | `ToolCallCard.test.tsx` covers registry label plus safe `ResponseError.message`. |

## Log Evidence

Expected log locations use `LOG_DATA_DIR` and JSONL-style files managed by the logger.

| Failure source | Expected code/category | Evidence |
|---|---|---|
| LLM provider/config failure | `LLM_PROVIDER_ERROR`, `LLM_CONFIG_ERROR`, or `UNKNOWN_ERROR` | `chat.route.test.ts` covers visible error text, sanitized provider raw error, and log files. |
| Agent runtime failure | `AGENT_RUNTIME_ERROR` | `chat.route.test.ts` covers fallback before visible output and `response_failed` after visible output. |
| Tool failure | `TOOL_CALL_ERROR` | Agent mapper and ToolCallCard tests cover failed tool events and safe error display. |
| Stream abort/disconnect | `STREAM_ABORTED` | LLM mapper and renderer normalizer tests cover abort mapping. |
| Persistence failure after completion | `chat.persistence` or equivalent persistence category | `chat.route.test.ts` covers log write and no duplicate terminal event. |

## Follow-Up Work

- Optional release-smoke step: after running against real providers, paste concrete prompts, captured SSE sequences, DOM/screenshot references, persistence results, and log file paths into this document or a dated verification appendix.
