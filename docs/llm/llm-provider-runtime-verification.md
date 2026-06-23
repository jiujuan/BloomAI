# LLM Provider Runtime Verification

Date: 2026-06-24

## Scope

This document records verification for the provider-based LLM runtime covering registry, settings, chat dispatch, image generation, and Agnes video tasks.

## Automated Coverage

The regression suite covers:

- Registry seed providers and text/image/video models.
- Provider key persistence and masked settings reads.
- New sessions using the saved default `settings.model`.
- Chat dispatch for Anthropic Claude, OpenAI GPT, Agnes text, DeepSeek, and imported Ollama models.
- Parser and adapter coverage for Anthropic events, OpenAI-compatible SSE, and Ollama NDJSON.
- OpenAI and Agnes Image request dispatch through `image_gen`.
- Agnes Video task creation, polling, status mapping, and completed URL mapping.
- `chat.route.ts` remaining vendor-neutral by importing the runtime instead of a vendor SDK.

## Verification Commands

| Command | Result |
| --- | --- |
| `npm test -- src/server/llm/llm-runtime.integration.test.ts` | Passed: 1 file, 4 tests |
| `npm test` | Passed: 19 files, 75 tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed after rerunning outside the managed sandbox because Vite/esbuild hit `spawn EPERM` inside the sandbox |
| `npm run lint` | Passed |

Note: On Windows in the managed sandbox, Vitest and Vite/esbuild can fail with `spawn EPERM`. When that happens, rerun the same command with approved elevated execution. The command output should still be read directly before accepting the result.

## Manual Server Check

Recommended command:

```bash
npm run start:server
```

Expected smoke checks:

- `GET /health` returns `{ "status": "ok" }`.
- `GET /api/v1/llm/providers` returns Anthropic, OpenAI, Agnes, DeepSeek, and Ollama without secret values.
- `GET /api/v1/llm/models?modality=text` returns Claude, GPT, Agnes, DeepSeek, and any imported Ollama text models.
- `POST /api/v1/llm/videos` creates an Agnes video task when `AGNES_API_KEY` or `agnes_api_key` is configured.
- `GET /api/v1/llm/videos/:id` returns current task status and completed video URL when Agnes reports completion.

## Manual UI Check

- Open Settings -> Models.
- Confirm text models include Claude, GPT, Agnes, DeepSeek, and imported Ollama models.
- Save provider keys and Ollama base URL.
- Select each text provider in Chat and send a short message.
- Run Image Generator with default OpenAI image model and Agnes Image.
- Create and query an Agnes Video task.

## Residual Risks

- Live provider behavior is verified with mocked provider responses in automated tests; real API credentials and account-level provider availability still need manual smoke testing.
- Browser UI interaction was not automated in Task 14 because this task focuses on backend runtime regression coverage and a manual verification script.
- Ollama chat requires a local Ollama server and imported model for real manual verification.
