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
| `npm test -- src/server/llm/response-event-mapper.test.ts src/server/agent/mastra/response-event-mapper.test.ts src/server/routes/chat-response-stream.test.ts src/server/routes/chat.route.test.ts` | Failed | 3 files passed and 1 file failed. `chat-response-stream.test.ts`, `src/server/agent/mastra/response-event-mapper.test.ts`, and `chat.route.test.ts` passed with 31 tests. `src/server/llm/response-event-mapper.test.ts` failed 3 tests because its mock for `../logger/logger` does not provide `sanitizeErrorMessage`. |
| `npm test -- src/renderer/api/chat-stream-normalizer.test.ts src/renderer/store/chat-response-reducer.test.ts src/renderer/store/index.test.ts` | Passed | 3 test files passed, 21 tests passed. |
| `npm test -- src/renderer/pages/Chat/Timeline.test.tsx src/renderer/pages/Chat/ToolCallGroupCard.test.tsx src/renderer/pages/Chat/ToolCallCard.test.tsx` | Passed | 3 test files passed, 20 tests passed. |
| `npm run build` | Passed | `tsc --noEmit`, Vite renderer build, and Electron build completed. |

### Open Verification Finding

The server mapper verification command currently has a test-mock gap:

- File: `src/server/llm/response-event-mapper.test.ts`
- Failure: the local mock for `../logger/logger` omits `sanitizeErrorMessage`
- Affected tests:
  - `does not start an empty content block when the source fails before content`
  - `emits response_failed when the source stream throws`
  - `maps aborted streams to STREAM_ABORTED failures`
- Task 13 boundary: do not fix this in the verification task. Track it as follow-up work before claiming the full server mapper suite is green.

## Unified Acceptance Checklist

| Area | Acceptance signal | Automated evidence | Manual evidence required |
|---|---|---|---|
| Contract schemas | v1 `ResponseStreamEvent` accepts known events and rejects malformed/unknown events. | `src/shared/schemas/response.test.ts` passed. | Capture a malformed chunk producing a visible error path. |
| Error registry | Known codes resolve to registry labels; unknown codes fall back to `UNKNOWN_ERROR`. | `src/shared/llm-response-contract/registry.test.ts` passed. | Confirm UI copy for `LLM_PROVIDER_ERROR`, `TOOL_CALL_ERROR`, and unknown code. |
| Direct LLM mapper | Success, before-content failure, partial failure, and abort map to terminal v1 events. | Server command has an open mock gap in `src/server/llm/response-event-mapper.test.ts`. | Capture SSE sequences for direct success/failure/abort. |
| Agent mapper | Tool events, fallback status, and response terminal events map to v1. | `src/server/agent/mastra/response-event-mapper.test.ts` passed. | Capture web search fallback sequence. |
| Stream writer | Response state writes content/tool/usage/error events and terminal event once. | `src/server/routes/chat-response-stream.test.ts` passed. | Confirm no duplicate terminal event in persistence failure case. |
| Chat route | Route handles response, error, logging, fallback, and persistence failure paths. | `src/server/routes/chat.route.test.ts` passed. | Confirm `LOG_DATA_DIR` file path for each logged failure. |
| Renderer normalizer | Legacy and v1 chunks normalize to unified `ResponseStreamEvent`; flush/abort are closed. | `src/renderer/api/chat-stream-normalizer.test.ts` passed. | Confirm malformed/unknown chunk is visible to the user. |
| Store reducer | Streaming state tracks markdown, tool calls, usage, error, and legacy compatibility fields. | `src/renderer/store/chat-response-reducer.test.ts` and `src/renderer/store/index.test.ts` passed. | Confirm no empty assistant bubble state condition. |
| Timeline UI | Timeline renders streaming blocks, grouped tools, errors, and waiting state without extra collapse depth. | `Timeline.test.tsx`, `ToolCallGroupCard.test.tsx`, and `ToolCallCard.test.tsx` passed. | Capture DOM/screenshot evidence for grouped and error states. |
| Persistence failure | Completed stream remains terminal, persistence exception is logged with diagnostic context. | `src/server/routes/chat.route.test.ts` passed. | Confirm log includes `sessionId`, `responseId`, text length, tool call count, and error message. |

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

| Scenario | Prompt/input | Expected SSE sequence | Timeline UI state | Assistant persistence | Tool trace persistence | Log evidence |
|---|---|---|---|---|---|---|
| 1. Direct LLM success | Ask a simple non-tool question. | Direct LLM success sequence. | Final markdown answer, no tool card. | Assistant message saved with final text. | No tool trace or empty trace. | None expected. |
| 2. Direct LLM before-content failure | Force provider failure before first token. | `response_started -> response_failed`. | Error block, no empty assistant bubble. | Product policy dependent: no assistant or error assistant only. | No tool trace. | `LOG_DATA_DIR/*.jsonl` with LLM provider/config error. |
| 3. Direct LLM after-partial failure | Force provider failure after at least one delta. | Partial failure sequence. | Partial markdown plus error block. | Partial assistant retained if route policy persists partial content. | No tool trace. | `LOG_DATA_DIR/*.jsonl` with provider error. |
| 4. Agent no-tool success | Ask an agent-routed question that needs no tool. | Agent no-tool success sequence. | Final markdown answer, no tool card. | Assistant saved. | Agent trace without tool calls or empty tool calls. | None expected. |
| 5. Agent web search success | Ask for current/search-dependent information. | Web search success sequence. | One `web_search` group plus final answer. | Assistant saved. | One successful `web_search` call saved. | None expected. |
| 6. Web search fallback success | Make primary search provider fail and fallback succeed. | Web search fallback success sequence. | One `web_search` group with fallback status. | Assistant saved. | One `web_search` call saved with fallback summary, not raw output. | Primary provider failure logged if policy logs soft provider failures. |
| 7. Tool soft failure + Agent continue | Make all search providers fail but let agent answer with limitations. | Soft failure continue sequence. | Failed/partial tool group plus completed answer. | Assistant saved with limitation text. | Failed tool call saved. | `LOG_DATA_DIR/*.jsonl` with `TOOL_CALL_ERROR`. |
| 8. Tool hard failure + response failed | Make required tool fail and prevent continuation. | Hard failure sequence. | Tool error plus response error. | Partial/error assistant per route policy. | Failed tool call saved. | `LOG_DATA_DIR/*.jsonl` with tool or agent error. |
| 9. Agent before-visible failure + Direct LLM fallback | Force agent init/planning failure before first visible event. | Fallback direct LLM sequence. | Direct LLM answer, no empty agent bubble. | Assistant saved from fallback response. | No agent tool trace. | Agent runtime failure log. |
| 10. Agent after-visible failure + response failed | Force agent failure after content/tool event. | After-visible failure sequence. | Partial state plus error; running tools interrupted. | Partial assistant per route policy. | Started/running tool trace saved as failed/interrupted evidence where available. | Agent runtime failure log. |
| 11. Stream aborted | Cancel request or disconnect SSE. | Abort sequence with `STREAM_ABORTED`. | Interrupted state, partial content preserved. | No final assistant or partial assistant per route policy. | Running tool trace marked interrupted where available. | Abort log at registry log level. |
| 12. Persistence failure after completed stream | Mock assistant/tool/tokens persistence throw after `response_completed`. | Completed sequence only; persistence failure happens after terminal event. | Completed answer remains in temporary UI state until reload. | Save failed. | Trace/token save failed if included in mock. | `chat.persistence` log includes `sessionId`, `responseId`, text length, tool call count, and error message. |

## UI DOM And Screenshot Evidence To Capture

Do not commit temporary screenshots unless the team explicitly asks for them. Store temporary captures outside the repo or discard them after the verification note is updated.

| UI evidence | Source coverage | What to capture manually |
|---|---|---|
| Response started with no blocks | `Timeline.test.tsx` covers no empty assistant bubble behavior. | DOM shows lightweight waiting state and no blank assistant bubble. |
| Adjacent web search calls grouped | `Timeline.test.tsx` and `ToolCallGroupCard.test.tsx` cover adjacent same-key grouping. | Five consecutive `web_search` calls render as one group card. |
| Markdown cuts tool group | `Timeline.test.tsx` covers markdown interruption of grouping. | `web_search -> markdown -> web_search` renders two group cards. |
| Fallback status message | `ToolCallGroupCard.test.tsx` covers `statusMessage` display. | Group body shows primary failure/fallback running/success text in the same card. |
| Partial answer plus error | `Timeline.test.tsx` covers response failure after content. | Partial markdown remains above readable error text. |
| Tool error text | `ToolCallCard.test.tsx` covers safe tool error display. | Card shows registry label plus safe raw message, without stack trace or secret config. |

## Log Evidence To Capture

Expected log locations use `LOG_DATA_DIR` and JSONL-style files managed by the logger.

| Failure source | Expected code/category | Required evidence |
|---|---|---|
| LLM provider/config failure | `LLM_PROVIDER_ERROR`, `LLM_CONFIG_ERROR`, or `UNKNOWN_ERROR` | Log file under `LOG_DATA_DIR` with sanitized message and no provider secrets. |
| Agent runtime failure | `AGENT_RUNTIME_ERROR` | Log file under `LOG_DATA_DIR` with session/response context when available. |
| Tool failure | `TOOL_CALL_ERROR` | Log file under `LOG_DATA_DIR`; Timeline tool card shows safe message. |
| Stream abort/disconnect | `STREAM_ABORTED` | Log level follows registry/equivalent mapping; UI shows interrupted state. |
| Persistence failure after completion | `chat.persistence` or equivalent persistence category | Log includes `sessionId`, `responseId`, text length, tool call count, and error message. |

## Follow-Up Work

- Fix the `src/server/llm/response-event-mapper.test.ts` logger mock so it provides `sanitizeErrorMessage`, then rerun the server mapper command.
- After manual E2E runs, paste concrete prompts, captured SSE sequences, DOM/screenshot references, persistence results, and log file paths into this document or a dated verification appendix.
