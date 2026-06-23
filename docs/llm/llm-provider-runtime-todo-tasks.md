# LLM Provider Runtime Todo Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` or an equivalent task-by-task execution flow. Execute tasks in order. Each task should leave the app in a buildable or narrowly testable state.

**Goal:** Implement a provider-based LLM runtime under `src/server/llm` and connect database settings, Settings UI, Chat streaming, image generation, and Agnes video task support.

**Architecture:** Add a backend LLM registry and provider runtime that resolves a model id to a provider implementation. Keep the existing Chat SSE contract stable while moving all vendor-specific model calls out of `chat.route.ts`. Settings keeps the current visual style, but model/provider data comes from backend registry APIs.

**Tech Stack:** TypeScript, Express, React, Zustand, sql.js, Vitest, native `fetch`, existing Anthropic SDK.

---

## Task 1: Create LLM Runtime Skeleton

**Goal:** Create the entire `src/server/llm` program skeleton, core interfaces, exported entry points, and placeholder functions that later tasks will fill in.

**Implementation Summary:** This task creates the stable internal contracts first: text chat streaming, image generation, video task generation, provider metadata, registry lookups, settings helpers, and provider files. It should compile, but provider functions may throw explicit `LlmUnsupportedModelError` until later tasks implement them.

**Files To Create:**

- `src/server/llm/index.ts`
- `src/server/llm/types.ts`
- `src/server/llm/errors.ts`
- `src/server/llm/settings.ts`
- `src/server/llm/registry.ts`
- `src/server/llm/stream.ts`
- `src/server/llm/providers/anthropic.ts`
- `src/server/llm/providers/openai-compatible.ts`
- `src/server/llm/providers/openai.ts`
- `src/server/llm/providers/agnes.ts`
- `src/server/llm/providers/deepseek.ts`
- `src/server/llm/providers/ollama.ts`
- `src/server/llm/media/image.ts`
- `src/server/llm/media/video.ts`

**Files To Modify:**

- None in this task.

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/server/db/client.ts`
- `src/renderer/pages/Settings/index.tsx`
- `src/renderer/pages/Chat/ChatPanel.tsx`
- `src/server/services/tool.service.ts`

**Core Interfaces To Define:**

```ts
export type LlmProviderId = 'anthropic' | 'openai' | 'agnes' | 'deepseek' | 'ollama' | string
export type LlmModality = 'text' | 'image' | 'video'

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatStreamRequest = {
  model: string
  system?: string
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' }

export type LlmProviderConfig = {
  id: string
  name: string
  kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  baseUrl: string | null
  apiKeySettingKey: string | null
  isEnabled: boolean
  config: Record<string, unknown>
}

export type LlmModelConfig = {
  id: string
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities: Record<string, unknown>
  isEnabled: boolean
  isBuiltin: boolean
  sortOrder: number
}

export interface ChatProvider {
  streamChat(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent>
}
```

**Core Functions To Define:**

```ts
export async function* streamChatCompletion(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent>
export async function generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResult>
export async function createVideoTask(input: VideoGenerationRequest): Promise<VideoTaskResult>
export async function getVideoTask(taskId: string): Promise<VideoTaskResult>
export async function listProviders(): Promise<LlmProviderConfig[]>
export async function listModels(modality?: LlmModality): Promise<LlmModelConfig[]>
export async function resolveModel(modelId: string, modality: LlmModality): Promise<ResolvedLlmModel>
export function parseOpenAICompatibleSseLine(line: string): OpenAIStreamParseResult
export function parseOllamaNdjsonLine(line: string): OllamaStreamParseResult
```

**Unit Test Strategy:**

- Create `src/server/llm/llm-skeleton.test.ts`.
- Assert `streamChatCompletion` exists and throws `LlmUnsupportedModelError` for an unknown model.
- Assert `parseOpenAICompatibleSseLine('data: [DONE]')` returns a done result.
- Assert exported error classes preserve `code` and `message`.

**Integration Test Strategy:**

- No HTTP integration yet. This task only establishes internal contracts.
- Run `npm run typecheck`.

**Acceptance Evidence Checklist:**

- [ ] `src/server/llm` directory exists with all planned files.
- [ ] `src/server/llm/index.ts` exports the public runtime functions.
- [ ] `src/server/llm/types.ts` contains text, image, video, provider, and model contracts.
- [ ] Runtime placeholder functions fail with typed LLM errors, not generic strings.
- [ ] `npm run typecheck` passes.

---

## Task 2: Add LLM Database Schema, Seed Data, And Repository

**Goal:** Add persistent provider/model registry storage and repository functions that the runtime can use.

**Implementation Summary:** Extend sql.js migrations with `llm_providers`, `llm_models`, and `llm_video_tasks`. Seed built-in Anthropic, OpenAI, Agnes, DeepSeek, and Ollama providers plus their default models. Add repository functions for list, get, update, create, and video task state.

**Files To Create:**

- `src/server/db/repositories/llm.repo.ts`
- `src/server/db/repositories/llm.repo.test.ts`

**Files To Modify:**

- `src/server/db/client.ts`
- `src/server/llm/registry.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Settings/index.tsx`
- `src/renderer/pages/Chat/ChatPanel.tsx`

**Provider Seed Requirements:**

- `anthropic`: kind `anthropic`, API key `anthropic_api_key`, base URL `https://api.anthropic.com`
- `openai`: kind `openai`, API key `openai_api_key`, base URL `https://api.openai.com/v1`
- `agnes`: kind `openai-compatible`, API key `agnes_api_key`, base URL `https://apihub.agnes-ai.com/v1`
- `deepseek`: kind `openai-compatible`, API key `deepseek_api_key`, base URL `https://api.deepseek.com/v1`
- `ollama`: kind `ollama`, no API key, base URL setting key handled by `ollama_base_url`

**Model Seed Requirements:**

- Anthropic text: `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`, `claude-3-haiku-20240307`
- OpenAI text: `gpt-4o`, `gpt-4o-mini`
- Agnes text: `agnes-2.0-flash`
- Agnes image: `agnes-image-2.1-flash`
- Agnes video: `agnes-video-v2.0`
- DeepSeek text: `deepseek-chat`, `deepseek-reasoner`
- Ollama: no specific built-in model rows until imported or manually added

**Repository Functions To Implement:**

```ts
listProviders(): LlmProviderRecord[]
getProvider(id: string): LlmProviderRecord | undefined
updateProvider(id: string, data: Partial<LlmProviderUpdate>): LlmProviderRecord | undefined
listModels(filter?: { modality?: LlmModality; providerId?: string; enabledOnly?: boolean }): LlmModelRecord[]
getModel(id: string): LlmModelRecord | undefined
createModel(input: CreateLlmModelInput): LlmModelRecord
updateModel(id: string, data: Partial<UpdateLlmModelInput>): LlmModelRecord | undefined
createVideoTask(input: CreateVideoTaskInput): LlmVideoTaskRecord
updateVideoTask(id: string, data: Partial<UpdateVideoTaskInput>): LlmVideoTaskRecord | undefined
getVideoTask(id: string): LlmVideoTaskRecord | undefined
```

**Unit Test Strategy:**

- Use an isolated temp `DATA_DIR` when possible.
- Verify built-in providers are inserted exactly once.
- Verify `listModels({ modality: 'text' })` includes Claude, GPT, Agnes text, and DeepSeek models.
- Verify `listModels({ modality: 'image' })` includes `agnes-image-2.1-flash`.
- Verify `listModels({ modality: 'video' })` includes `agnes-video-v2.0`.
- Verify `updateProvider('openai', { isEnabled: false })` persists.

**Integration Test Strategy:**

- Start server with a temp DB and call later LLM model APIs after Task 7.
- For this task, run repository tests plus `npm run typecheck`.

**Acceptance Evidence Checklist:**

- [ ] `llm_providers`, `llm_models`, and `llm_video_tasks` are created by `runMigrations`.
- [ ] Built-in providers and models are seeded without duplicating rows on repeated startup.
- [ ] `settings` seed includes `agnes_api_key`, `deepseek_api_key`, `ollama_base_url`, `default_image_model`, and `default_video_model`.
- [ ] `llm.repo.ts` exposes typed repository helpers.
- [ ] Unit tests prove seed and repository behavior.

---

## Task 3: Implement Registry And Settings Resolution

**Goal:** Resolve any model id to a provider/model pair and read provider configuration safely.

**Implementation Summary:** Fill `src/server/llm/registry.ts` and `settings.ts` using `llm.repo.ts` and existing `settings` table. This task makes the runtime capable of determining which provider handles a model before any vendor call is implemented.

**Files To Modify:**

- `src/server/llm/registry.ts`
- `src/server/llm/settings.ts`
- `src/server/llm/errors.ts`

**Files To Create:**

- `src/server/llm/registry.test.ts`
- `src/server/llm/settings.test.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Settings/index.tsx`
- `src/server/services/tool.service.ts`

**Functions To Implement:**

```ts
resolveModel(modelId: string, modality: LlmModality): Promise<ResolvedLlmModel>
listProviders(): Promise<LlmProviderConfig[]>
listModels(modality?: LlmModality): Promise<LlmModelConfig[]>
getSettingValue(key: string): string
getProviderApiKey(provider: LlmProviderConfig): string
getProviderBaseUrl(provider: LlmProviderConfig): string
```

**Behavior Requirements:**

- Unknown model id throws `LlmUnsupportedModelError`.
- Disabled provider throws `LlmConfigError`.
- Disabled model throws `LlmConfigError`.
- Modality mismatch throws `LlmUnsupportedModelError`.
- API key lookup checks settings first, then provider-specific env vars:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `AGNES_API_KEY`
  - `DEEPSEEK_API_KEY`
- Ollama base URL uses `settings.ollama_base_url`, then provider base URL, then `http://127.0.0.1:11434`.

**Unit Test Strategy:**

- Resolve `gpt-4o` with modality `text` and assert provider is `openai`.
- Resolve `agnes-image-2.1-flash` with modality `image` and assert provider is `agnes`.
- Resolve `agnes-video-v2.0` with modality `video` and assert provider is `agnes`.
- Resolve `agnes-video-v2.0` with modality `text` and assert a typed unsupported model error.
- Disable provider and assert calls fail before vendor fetch.

**Integration Test Strategy:**

- After Task 7, `GET /api/v1/llm/models?modality=text` should use these functions.

**Acceptance Evidence Checklist:**

- [ ] Model-to-provider resolution works for Anthropic, OpenAI, Agnes, DeepSeek.
- [ ] Ollama base URL resolution works without an API key.
- [ ] Disabled provider/model behavior is deterministic.
- [ ] Errors expose stable codes for route handlers.

---

## Task 4: Implement Anthropic Provider And Preserve Existing Claude Behavior

**Goal:** Move current Claude streaming behavior from `chat.route.ts` into `src/server/llm/providers/anthropic.ts`.

**Implementation Summary:** Implement Anthropic provider using the existing `@anthropic-ai/sdk`. Do not change `chat.route.ts` yet; tests call the provider directly.

**Files To Modify:**

- `src/server/llm/providers/anthropic.ts`
- `src/server/llm/index.ts`

**Files To Create:**

- `src/server/llm/providers/anthropic.test.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Chat/ChatPanel.tsx`

**Functions To Implement:**

```ts
export function createAnthropicProvider(resolved: ResolvedLlmModel): ChatProvider
```

**Behavior Requirements:**

- Convert `system` into Anthropic `system`.
- Convert only user/assistant messages into Anthropic `messages`.
- Use `maxTokens || 4096`.
- Emit `{ type: 'delta', text }` for text events.
- Emit `{ type: 'usage', input, output }` from final message usage.
- Map vendor errors to `LlmProviderError`.

**Unit Test Strategy:**

- Mock `@anthropic-ai/sdk`.
- Assert `client.messages.stream` receives `model`, `system`, `messages`, and `max_tokens`.
- Assert emitted provider events include delta and usage.
- Assert missing API key throws `LlmConfigError`.

**Integration Test Strategy:**

- Keep existing chat route unchanged in this task, so no HTTP integration yet.

**Acceptance Evidence Checklist:**

- [ ] Anthropic provider reproduces current request shape.
- [ ] Provider stream emits the runtime event contract.
- [ ] Existing Claude route is untouched until Task 8.

---

## Task 5: Implement OpenAI-Compatible Stream Parser And OpenAI GPT Provider

**Goal:** Add real GPT chat support for `gpt-4o`, `gpt-4o-mini`, and future OpenAI models.

**Implementation Summary:** Fill the generic OpenAI-compatible SSE parser and the OpenAI provider. Use native `fetch` instead of adding a new SDK.

**Files To Modify:**

- `src/server/llm/stream.ts`
- `src/server/llm/providers/openai-compatible.ts`
- `src/server/llm/providers/openai.ts`
- `src/server/llm/index.ts`

**Files To Create:**

- `src/server/llm/stream.test.ts`
- `src/server/llm/providers/openai-compatible.test.ts`
- `src/server/llm/providers/openai.test.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Settings/index.tsx`

**Functions To Implement:**

```ts
parseOpenAICompatibleSseLine(line: string): OpenAIStreamParseResult
createOpenAICompatibleProvider(resolved: ResolvedLlmModel): ChatProvider
createOpenAIProvider(resolved: ResolvedLlmModel): ChatProvider
```

**Behavior Requirements:**

- Request URL: `${baseUrl}/chat/completions`.
- Headers: `Authorization: Bearer <apiKey>`, `Content-Type: application/json`.
- Request body includes `model`, `messages`, `stream: true`, `max_tokens`.
- `system` becomes the first `messages` entry with role `system`.
- Parse `choices[0].delta.content`.
- Treat `data: [DONE]` as stream completion.
- Usage is optional; missing usage should not fail the stream.

**Unit Test Strategy:**

- Parse a normal SSE line with delta content.
- Parse `[DONE]`.
- Ignore empty keepalive lines.
- Mock `fetch` and assert OpenAI provider sends request to `https://api.openai.com/v1/chat/completions`.
- Assert `gpt-4o` and `gpt-4o-mini` resolve through OpenAI provider.

**Integration Test Strategy:**

- After Task 8, stream a mocked HTTP response through `/api/v1/chat/stream` with a `gpt-4o` session.

**Acceptance Evidence Checklist:**

- [ ] `gpt-4o` and `gpt-4o-mini` have real backend provider support.
- [ ] OpenAI-compatible parser is reusable by Agnes and DeepSeek.
- [ ] Provider handles stream chunks without requiring usage.

---

## Task 6: Implement Agnes Text And DeepSeek Providers

**Goal:** Support Agnes text model and DeepSeek models through the OpenAI-compatible provider.

**Implementation Summary:** Fill provider wrappers for Agnes and DeepSeek. They should delegate text streaming to `createOpenAICompatibleProvider` with provider-specific base URL and API key.

**Files To Modify:**

- `src/server/llm/providers/agnes.ts`
- `src/server/llm/providers/deepseek.ts`
- `src/server/llm/index.ts`

**Files To Create:**

- `src/server/llm/providers/agnes.test.ts`
- `src/server/llm/providers/deepseek.test.ts`

**Files Not To Modify:**

- `src/server/services/tool.service.ts`
- `src/server/routes/chat.route.ts`
- `docs/agnes/agnes-Agnes-Video-V2.0-API-docs.md`

**Functions To Implement:**

```ts
createAgnesTextProvider(resolved: ResolvedLlmModel): ChatProvider
createDeepSeekProvider(resolved: ResolvedLlmModel): ChatProvider
```

**Behavior Requirements:**

- Agnes text model `agnes-2.0-flash` uses `https://apihub.agnes-ai.com/v1/chat/completions`.
- DeepSeek models use `https://api.deepseek.com/v1/chat/completions`.
- Agnes key comes from `agnes_api_key` or `AGNES_API_KEY`.
- DeepSeek key comes from `deepseek_api_key` or `DEEPSEEK_API_KEY`.
- Both providers emit the standard chat stream events.

**Unit Test Strategy:**

- Mock `fetch` and assert Agnes request URL and model id.
- Mock `fetch` and assert DeepSeek request URL and model id.
- Assert missing Agnes key and missing DeepSeek key produce provider-specific config errors.

**Integration Test Strategy:**

- After Task 8, create sessions with `agnes-2.0-flash`, `deepseek-chat`, and `deepseek-reasoner`; assert `/chat/stream` selects the correct provider with mocked fetch.

**Acceptance Evidence Checklist:**

- [ ] `agnes-2.0-flash` can be resolved and streamed.
- [ ] `deepseek-chat` and `deepseek-reasoner` can be resolved and streamed.
- [ ] Error messages tell the user which API key is missing.

---

## Task 7: Implement Ollama Provider And Local Model Discovery

**Goal:** Support local Ollama text chat and model import/discovery.

**Implementation Summary:** Implement Ollama chat streaming via `/api/chat` and model discovery via `/api/tags`. Ollama does not need an API key.

**Files To Modify:**

- `src/server/llm/providers/ollama.ts`
- `src/server/llm/index.ts`
- `src/server/db/repositories/llm.repo.ts`

**Files To Create:**

- `src/server/llm/providers/ollama.test.ts`

**Files Not To Modify:**

- `src/renderer/pages/Settings/index.tsx`
- `src/server/routes/chat.route.ts`

**Functions To Implement:**

```ts
createOllamaProvider(resolved: ResolvedLlmModel): ChatProvider
listOllamaRemoteModels(): Promise<OllamaRemoteModel[]>
importOllamaModel(modelName: string): LlmModelRecord
```

**Behavior Requirements:**

- Base URL resolves from `settings.ollama_base_url`, then provider base URL, then `http://127.0.0.1:11434`.
- Request URL: `${baseUrl}/api/chat`.
- Request body includes `model`, `messages`, `stream: true`.
- Parse NDJSON lines with `message.content`.
- Stop when `done: true`.
- `/api/tags` model discovery returns local model names and metadata.

**Unit Test Strategy:**

- Parse Ollama NDJSON delta line.
- Parse Ollama `done: true` line.
- Mock `fetch` and assert `/api/chat` request shape.
- Mock `/api/tags` and assert model names are imported as text models under provider `ollama`.

**Integration Test Strategy:**

- After Task 9, call `GET /api/v1/llm/ollama/models` with mocked fetch.
- After Task 8, session model set to imported Ollama model streams via `/chat/stream`.

**Acceptance Evidence Checklist:**

- [ ] Ollama provider works without API key.
- [ ] Local models can be discovered and imported.
- [ ] Imported Ollama models appear in text model list.

---

## Task 8: Wire Chat Route To LLM Runtime

**Goal:** Make `/api/v1/chat/stream` call `src/server/llm` instead of directly calling Anthropic.

**Implementation Summary:** Replace direct SDK usage in `chat.route.ts` with `streamChatCompletion`. Keep SSE output shape stable so the frontend Chat store does not change.

**Files To Modify:**

- `src/server/routes/chat.route.ts`
- `src/server/llm/index.ts`

**Files To Create:**

- `src/server/routes/chat.route.test.ts`

**Files Not To Modify:**

- `src/renderer/store/index.ts`
- `src/renderer/api/index.ts` SSE parser
- `src/renderer/pages/Chat/InputBar.tsx`
- `src/renderer/pages/Chat/Timeline.tsx`
- `src/renderer/pages/Chat/MessageBubble.tsx`

**Route Behavior Requirements:**

- Continue accepting `{ sessionId, content, contextOverride }`.
- Continue sending `{ type: 'delta', text }`.
- Continue sending `{ type: 'done', tokens }`.
- Continue sending `{ type: 'error', error }`.
- Preserve session title update on first user message.
- Preserve assistant message persistence.
- Selected model priority remains:
  - `persona.model_override`
  - `session.model`
  - `settings.model`
  - `claude-3-5-sonnet-20241022`

**Unit Test Strategy:**

- Mock `streamChatCompletion` and assert route forwards model, system, and messages.
- Assert route persists user message before streaming.
- Assert route persists assistant message after streaming.
- Assert partial assistant text is saved on stream error when non-empty.

**Integration Test Strategy:**

- Seed a session with `gpt-4o`, mock provider fetch, call `/api/v1/chat/stream`, assert SSE deltas and done.
- Seed a session with `claude-3-haiku-20240307`, mock Anthropic provider, assert old Claude flow still streams.
- Seed a persona override and assert override wins over session model.

**Acceptance Evidence Checklist:**

- [ ] `chat.route.ts` no longer imports `@anthropic-ai/sdk`.
- [ ] `chat.route.ts` imports from `../llm`.
- [ ] Chat SSE protocol remains unchanged.
- [ ] Claude, GPT, Agnes, DeepSeek, and Ollama can be selected by changing session model.

---

## Task 9: Add LLM REST API

**Goal:** Expose provider/model registry APIs for Settings and future admin workflows.

**Implementation Summary:** Add `llm.route.ts`, wire it into `app.ts`, and add platform client methods later used by Settings.

**Files To Create:**

- `src/server/routes/llm.route.ts`
- `src/server/routes/llm.route.test.ts`

**Files To Modify:**

- `src/server/app.ts`
- `src/renderer/api/index.ts`

**Files Not To Modify:**

- `src/renderer/pages/Settings/index.tsx`
- `src/renderer/pages/Chat/ChatPanel.tsx`

**Endpoints To Implement:**

```text
GET   /api/v1/llm/providers
PATCH /api/v1/llm/providers/:id
GET   /api/v1/llm/models?modality=text|image|video
POST  /api/v1/llm/models
PATCH /api/v1/llm/models/:id
GET   /api/v1/llm/ollama/models
```

**Platform Methods To Add:**

```ts
getLlmProviders(): Promise<LlmProviderSummary[]>
updateLlmProvider(id: string, updates: object): Promise<LlmProviderSummary>
getLlmModels(modality?: 'text' | 'image' | 'video'): Promise<LlmModelSummary[]>
createLlmModel(input: object): Promise<LlmModelSummary>
updateLlmModel(id: string, updates: object): Promise<LlmModelSummary>
getOllamaModels(): Promise<OllamaRemoteModel[]>
```

**Unit Test Strategy:**

- Route validation rejects invalid modality.
- Provider PATCH only updates allowed fields: `name`, `baseUrl`, `isEnabled`, `config`.
- Model POST requires `providerId`, `modelId`, `label`, and `modality`.
- API keys are never returned by provider endpoints.

**Integration Test Strategy:**

- Call `GET /api/v1/llm/models?modality=text` and assert text seed models.
- Call `PATCH /api/v1/llm/providers/openai` to disable provider and assert registry observes disabled state.
- Call `POST /api/v1/llm/models` to add a custom OpenAI-compatible model and assert it appears in list.

**Acceptance Evidence Checklist:**

- [ ] `/api/v1/llm/providers` returns providers with `hasApiKey` but no secret values.
- [ ] `/api/v1/llm/models?modality=text` returns all enabled text models in sort order.
- [ ] Platform client exposes LLM API methods.
- [ ] Existing API routes remain unchanged.

---

## Task 10: Update Settings Models UI

**Goal:** Make `Settings -> Models` manage provider keys and model defaults through the backend LLM registry while keeping the existing visual style.

**Implementation Summary:** Extend current Settings page instead of redesigning it. Load text/image/video models from the new API. Add Agnes, DeepSeek, and Ollama settings rows. Preserve existing `model-card`, `api-key-row`, and `btn-primary` styling.

**Files To Modify:**

- `src/renderer/pages/Settings/index.tsx`
- `src/renderer/store/index.ts`
- `src/renderer/api/index.ts`
- `src/server/routes/settings.route.ts`

**Files Not To Modify:**

- `src/renderer/styles/global.css`, unless existing spacing breaks
- `src/renderer/pages/Chat/InputBar.tsx`
- `src/renderer/pages/Chat/Timeline.tsx`

**UI Sections To Implement:**

- `Default Chat Model`
  - Load from `getLlmModels('text')`.
  - Click saves `settings.model`.

- `API Keys`
  - Anthropic -> `anthropic_api_key`
  - OpenAI -> `openai_api_key`
  - Agnes -> `agnes_api_key`
  - DeepSeek -> `deepseek_api_key`
  - Ollama Base URL -> `ollama_base_url`

- `Default Image Model`
  - Load from `getLlmModels('image')`.
  - Click saves `default_image_model`.

- `Default Video Model`
  - Load from `getLlmModels('video')`.
  - Click saves `default_video_model`.

**Settings Route Requirements:**

- Mask `agnes_api_key`.
- Mask `deepseek_api_key`.
- Do not mask `ollama_base_url`.
- Continue masking existing Anthropic/OpenAI keys.

**Unit Test Strategy:**

- Settings component can render with mocked models for text/image/video.
- Clicking a text model calls `updateSetting('model', id)`.
- Saving Agnes key writes `agnes_api_key`.
- Saving DeepSeek key writes `deepseek_api_key`.
- Ollama base URL remains visible as normal text config.

**Integration Test Strategy:**

- `GET /api/v1/settings` masks all API keys.
- `PATCH /api/v1/settings` saves new provider keys.
- Load Settings page with API mocked to return all model modalities and assert cards appear.

**Acceptance Evidence Checklist:**

- [ ] Settings shows backend-provided text models, not only hardcoded constants.
- [ ] Settings can save Anthropic/OpenAI/Agnes/DeepSeek keys and Ollama base URL.
- [ ] Settings can choose default image and video models.
- [ ] UI uses existing Settings visual language.

---

## Task 11: Update Chat Model Dropdown To Use Backend Text Models

**Goal:** Make Chat model selection use the same backend model registry as Settings.

**Implementation Summary:** Load text models from the LLM API for Chat's `ModelDropdown`. Keep the same dropdown visual behavior and session update call.

**Files To Modify:**

- `src/renderer/pages/Chat/ChatPanel.tsx`
- `src/renderer/store/index.ts`
- `src/renderer/api/index.ts`

**Files Not To Modify:**

- `src/renderer/pages/Chat/InputBar.tsx`
- `src/renderer/pages/Chat/Timeline.tsx`
- `src/renderer/pages/Chat/MessageBubble.tsx`
- `src/server/routes/chat.route.ts`

**Behavior Requirements:**

- Dropdown list comes from `getLlmModels('text')`.
- If backend loading fails, fallback to `AVAILABLE_MODELS`.
- Current session model still displays via label lookup.
- Selecting a model still calls `platform.updateSession(activeSessionId, { model: newModel })`.
- Session list reload still happens after model change.

**Unit Test Strategy:**

- Mock platform model list and assert dropdown renders GPT, Agnes, DeepSeek, Claude.
- Mock empty backend response and assert fallback constants render.
- Select `agnes-2.0-flash` and assert session update payload.

**Integration Test Strategy:**

- With server running, call `GET /api/v1/llm/models?modality=text`, then render Chat model dropdown with response.
- Select `gpt-4o`, send message, assert `/chat/stream` resolves OpenAI provider in Task 8 tests.

**Acceptance Evidence Checklist:**

- [x] Chat dropdown shows the same enabled text models as Settings.
- [x] Chat model selection persists to `sessions.model`.
- [x] Fallback prevents empty dropdown if LLM API is temporarily unavailable.

---

## Task 12: Implement Image Runtime And Wire `image_gen`

**Goal:** Move image generation into `src/server/llm/media/image.ts` and support Agnes Image alongside existing OpenAI image generation.

**Implementation Summary:** Preserve the current `image_gen` tool behavior for OpenAI, add optional model/provider selection, and support Agnes Image request quirks.

**Files To Modify:**

- `src/server/llm/media/image.ts`
- `src/server/services/tool.service.ts`
- `src/server/db/client.ts`

**Files To Create:**

- `src/server/llm/media/image.test.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Chat/ChatPanel.tsx`

**Functions To Implement:**

```ts
generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResult>
generateOpenAIImage(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult>
generateAgnesImage(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult>
saveGeneratedImage(url: string, saveTo: string): Promise<string>
```

**Tool Input Requirements:**

- Existing fields remain:
  - `prompt`
  - `size`
  - `quality`
  - `saveTo`
- Add optional fields:
  - `model`
  - `image`
  - `responseFormat`

**Agnes Image Requirements:**

- Endpoint: `https://apihub.agnes-ai.com/v1/images/generations`.
- Model: `agnes-image-2.1-flash`.
- `response_format` must be nested under `extra_body`.
- Image-to-image input must be nested under `extra_body.image`.
- URL output reads `data[0].url`.
- Base64 output reads `data[0].b64_json`.

**Unit Test Strategy:**

- OpenAI image path preserves current request shape for DALL-E.
- Agnes URL output puts `response_format` under `extra_body`.
- Agnes image-to-image puts input image array under `extra_body.image`.
- `saveTo` downloads URL response and writes local file.

**Integration Test Strategy:**

- Run `POST /api/v1/tools/image_gen/run` with mocked OpenAI response and assert success.
- Run `POST /api/v1/tools/image_gen/run` with `model: 'agnes-image-2.1-flash'` and mocked Agnes response.
- Assert `tool_runs` records success and output JSON includes provider/model.

**Acceptance Evidence Checklist:**

- [x] Existing OpenAI `image_gen` behavior still works.
- [x] Agnes Image can be selected by model.
- [x] Tool schema includes new optional fields.
- [x] Agnes-specific request shape is covered by tests.

---

## Task 13: Implement Agnes Video Runtime And API/Tool Entry

**Goal:** Support Agnes Video V2.0 as an asynchronous video generation task.

**Implementation Summary:** Implement video task creation and lookup in `src/server/llm/media/video.ts`. Expose either LLM video routes or a `video_gen` tool. Prefer LLM routes first for clean task status polling; add tool wrapper if product flow needs it.

**Files To Modify:**

- `src/server/llm/media/video.ts`
- `src/server/routes/llm.route.ts`
- `src/server/db/repositories/llm.repo.ts`
- `src/server/db/client.ts`

**Files To Create:**

- `src/server/llm/media/video.test.ts`

**Files Not To Modify:**

- `src/server/routes/chat.route.ts`
- `src/renderer/pages/Chat/ChatPanel.tsx`
- `src/renderer/pages/Settings/index.tsx`

**Endpoints To Implement:**

```text
POST /api/v1/llm/videos
GET  /api/v1/llm/videos/:id
```

**Functions To Implement:**

```ts
createVideoTask(input: VideoGenerationRequest): Promise<VideoTaskResult>
getVideoTask(taskId: string): Promise<VideoTaskResult>
createAgnesVideoTask(input: ResolvedVideoGenerationRequest): Promise<VideoTaskResult>
getAgnesVideoTask(task: LlmVideoTaskRecord): Promise<VideoTaskResult>
```

**Agnes Video Requirements:**

- Create endpoint: `POST https://apihub.agnes-ai.com/v1/videos`.
- Query endpoint: `GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>`.
- Model: `agnes-video-v2.0`.
- Store `task_id` and `video_id` in `llm_video_tasks`.
- Map completed video URL from `remixed_from_video_id`.

**Unit Test Strategy:**

- Mock create response and assert local video task row is created.
- Mock query response for `queued`, `in_progress`, `completed`, `failed`.
- Assert completed response maps URL correctly.
- Assert request body includes prompt, dimensions, frames, frame rate, and optional image.

**Integration Test Strategy:**

- Call `POST /api/v1/llm/videos` with mocked Agnes response, assert local task id.
- Call `GET /api/v1/llm/videos/:id` with mocked Agnes query response, assert status update.

**Acceptance Evidence Checklist:**

- [x] Agnes Video task can be created.
- [x] Task status can be queried.
- [x] Completed video URL is returned.
- [x] Video task is not coupled to Chat SSE.

---

## Task 14: Add End-To-End Regression Tests And Verification Script

**Goal:** Prove the full provider runtime works across registry, settings, chat, and media paths.

**Implementation Summary:** Add focused tests and a manual verification checklist. This task closes the implementation by showing that old Claude behavior is preserved and new providers are actually wired.

**Files To Create:**

- `src/server/llm/llm-runtime.integration.test.ts`
- `docs/llm/llm-provider-runtime-verification.md`

**Files To Modify:**

- Test-related files only, if needed.

**Files Not To Modify:**

- Production source files, unless tests expose a defect.

**Unit Test Strategy:**

- All provider parser tests pass:
  - Anthropic event adapter
  - OpenAI-compatible SSE
  - Ollama NDJSON
  - Agnes Image request shape
  - Agnes Video task mapping

**Integration Test Strategy:**

- Registry returns seed providers and models.
- Settings can save keys and mask them on read.
- New session uses saved default `settings.model`.
- Chat stream dispatches:
  - Claude -> Anthropic provider
  - `gpt-4o` -> OpenAI provider
  - `agnes-2.0-flash` -> Agnes provider
  - `deepseek-chat` -> DeepSeek provider
  - imported Ollama model -> Ollama provider
- `image_gen` dispatches OpenAI and Agnes image models.
- Agnes Video routes create and query tasks.

**Manual Verification Commands:**

```bash
npm run typecheck
npm test
npm run build
npm run start:server
```

**Manual UI Verification:**

- Open Settings -> Models.
- Confirm text models include Claude, GPT, Agnes, DeepSeek, and imported Ollama models.
- Save provider keys and Ollama base URL.
- Select each text provider in Chat and send a short message.
- Run Image Generator with OpenAI and Agnes Image.
- Create and query an Agnes Video task.

**Acceptance Evidence Checklist:**

- [x] `npm run typecheck` passes.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `chat.route.ts` imports no vendor SDK.
- [x] Provider runtime tests cover every supported provider.
- [x] Verification document records commands, results, and any residual risks.

---

## Cross-Task Non-Goals

These are intentionally outside this implementation plan:

- Do not redesign Chat UI.
- Do not replace sql.js.
- Do not add a full workflow engine.
- Do not route Skills `prompt-template` through LLM runtime yet.
- Do not implement multimodal image input in Chat text messages yet.
- Do not remove `src/shared/constants/models.ts` until all current UI users have safe backend-backed alternatives.

## Final Acceptance Criteria

- [x] `src/server/llm` owns all provider-specific text chat calls.
- [x] Database registry stores providers, models, and video tasks.
- [x] Settings can configure provider keys and default text/image/video models.
- [x] Chat can call Anthropic, OpenAI GPT, Agnes text, DeepSeek, and Ollama through one runtime.
- [x] Image generation can call OpenAI and Agnes Image through one runtime.
- [x] Agnes Video can create and query async tasks.
- [x] Existing Chat SSE protocol remains compatible with the current frontend store.
- [x] Claude default chat continues to work after migration.
