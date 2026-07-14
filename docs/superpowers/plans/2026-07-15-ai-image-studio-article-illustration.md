# AI Image Studio Article Illustration Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recoverable Article Illustration mode to Image Studio that accepts text, consented URL, or supported documents; creates an editable scene plan; and generates scenes through an eligible Package Skill or the existing image-model fallback.

**Architecture:** Keep existing single-image sessions and `GenerationCard` behavior unchanged. Add a persisted article-illustration job/scene model, a bounded article-source extraction service, and `/article-illustrations` HTTP routes. The renderer owns a separate Zustand workbench store. A Package Skill Run is used when a compatible Package Skill is selected; otherwise the existing Image Studio generation service creates one durable generation record per scene in a linked image session.

**Tech Stack:** React 18, Zustand, TypeScript, Hono, Zod, SQLite/Drizzle, Vitest, Mammoth, PDFParse, existing Image Studio service and Package Runtime APIs.

---

## File Structure

- Create: `scripts/migrations/007-article-illustration-jobs.sql` — durable jobs and scene records with indexes for recoverable image workflows.
- Modify: `src/server/db/schema.ts` — Drizzle table declarations for job/scene persistence.
- Create: `src/server/db/repositories/article-illustration.repo.ts` — transactional job, scene, plan, and retry persistence API.
- Create: `src/server/skills/article-illustrations/article-source.ts` — bounded text/URL/document extraction, URL safety validation, source normalization.
- Create: `src/server/skills/article-illustrations/illustration-planner.ts` — deterministic, editable initial-scene planner and Markdown manifest builder.
- Create: `src/server/skills/article-illustrations/article-illustration.service.ts` — plan creation, Package Run creation/confirmation, model-fallback batch generation, retry, recovery, and export orchestration.
- Create: `src/server/http/routes/article-illustrations.ts` — Hono validation and route surface.
- Create: `src/server/http/routes/article-illustrations.test.ts` — route/service integration coverage.
- Modify: `src/server/http/app.ts` — mount the article-illustration routes under `/api/v1`.
- Create: `src/renderer/pages/ImageStudio/article-illustration.types.ts` — renderer DTOs and scene/job state types.
- Create: `src/renderer/pages/ImageStudio/article-illustration.store.ts` — isolated Zustand workbench store and API calls.
- Create: `src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx` — article-mode composition root.
- Create: `src/renderer/pages/ImageStudio/article-illustration/ArticleSourceCard.tsx` — pasted text, consented URL, and supported-file source inputs.
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationConfigCard.tsx` — Package Skill/model fallback selection and count/ratio/style/model configuration.
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationPlanEditor.tsx` — editable/add/remove/reorder scene plan.
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationRunPanel.tsx` — Run status, resume/confirm, per-scene retry, `GenerationCard` output, and export.
- Modify: `src/renderer/pages/ImageStudio/index.tsx` — top-level single-image/article mode switch; preserve current single-image layout.
- Modify: `src/renderer/api/index.ts` — strongly typed article-illustration API client.
- Modify: `src/renderer/styles/global.css` — responsive styles for the article workbench.
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md` — check TODO 15 only after acceptance is green.

## Task 1: Persisted Article Illustration Contracts

**Files:**
- Create: `scripts/migrations/007-article-illustration-jobs.sql`
- Modify: `src/server/db/schema.ts`
- Create: `src/server/db/repositories/article-illustration.repo.ts`
- Test: `src/server/db/repositories/article-illustration.repo.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create a temporary DB-backed test that creates one job with `source_type = 'text'`, persists three ordered scenes, updates an edited prompt, and returns `waiting_approval` jobs after a simulated restart query. Assert that scene order and retry counts survive reads.

```ts
const job = repo.createJob({ sourceType: 'text', sourceLabel: '示例文章', articleText: '...', mode: 'fallback', config })
repo.replaceScenes(job.id, [{ ordinal: 1, title: '开场', prompt: '...' }])
repo.updateScene(job.id, scene.id, { prompt: 'edited' })
expect(repo.listRecoverable()).toContainEqual(expect.objectContaining({ id: job.id, status: 'waiting_approval' }))
```

- [ ] **Step 2: Run the repository test and verify RED**

Run: `npx vitest run src/server/db/repositories/article-illustration.repo.test.ts --pool=forks`

Expected: FAIL because the repository and tables do not exist.

- [ ] **Step 3: Add the migration and Drizzle contract**

Add `article_illustration_jobs` with `id`, `source_type`, `source_label`, `source_url`, `article_text`, `mode`, `skill_version_id`, `run_id`, `image_session_id`, `config_json`, `status`, `error_message`, timestamps. Add `article_illustration_scenes` with `id`, `job_id`, `ordinal`, `title`, `excerpt`, `prompt`, `status`, `generation_id`, `error_message`, `retry_count`, timestamps. Add indexes for `(status, updated_at)` and `(job_id, ordinal)`.

- [ ] **Step 4: Implement minimal repository methods**

Implement `createJob`, `getJob`, `listRecoverable`, `updateJob`, `replaceScenes`, `listScenes`, `updateScene`, and `incrementSceneRetry`. `replaceScenes` must delete old scenes and insert the supplied ordered set inside one transaction. Every read must decode JSON configuration and every write must update `updated_at`.

- [ ] **Step 5: Run the repository test and verify GREEN**

Run: `npx vitest run src/server/db/repositories/article-illustration.repo.test.ts --pool=forks`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add scripts/migrations/007-article-illustration-jobs.sql src/server/db/schema.ts src/server/db/repositories/article-illustration.repo.ts src/server/db/repositories/article-illustration.repo.test.ts
git commit -m "feat(image): persist article illustration jobs"
```

## Task 2: Article Source Extraction and Initial Plan

**Files:**
- Create: `src/server/skills/article-illustrations/article-source.ts`
- Create: `src/server/skills/article-illustrations/article-source.test.ts`
- Create: `src/server/skills/article-illustrations/illustration-planner.ts`
- Create: `src/server/skills/article-illustrations/illustration-planner.test.ts`

- [ ] **Step 1: Write failing extraction and planning tests**

Cover: text normalization; URL input rejected without `consent: true`; local/private/non-HTTP URL rejection; a mocked successful HTML fetch; fetch failure that returns a typed `ARTICLE_FETCH_FAILED`; MD/TXT/DOCX/PDF extraction using the existing attachment parsers; unsupported file rejection; and a deterministic plan whose scene count is clamped to `1..12`.

```ts
await expect(extractArticle({ type: 'url', url: 'https://example.test/a', consent: false })).rejects.toMatchObject({ code: 'URL_CONSENT_REQUIRED' })
expect(createIllustrationPlan({ text: article, imageCount: 3, style: 'editorial' })).toHaveLength(3)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run src/server/skills/article-illustrations/article-source.test.ts src/server/skills/article-illustrations/illustration-planner.test.ts --pool=forks`

Expected: FAIL because extraction/planning modules do not exist.

- [ ] **Step 3: Implement bounded source extraction**

Define Zod input contracts with a 100,000-character normalized text cap and a 15 MB upload cap. Require explicit URL consent, permit only `http:`/`https:`, reject localhost/private/link-local IP literals, set a timeout and byte cap, strip scripts/styles from HTML, and collapse whitespace. Reuse `parsePdf`, `parseDocx`, and `readTextFile` for safe supported document parsing. Return `{ title, text, sourceType, sourceLabel, sourceUrl? }` and typed errors suitable for HTTP mapping.

- [ ] **Step 4: Implement deterministic editable planning**

Split normalized text into meaningful paragraph/heading sections, select evenly distributed excerpts, and generate scenes with stable IDs, title, excerpt, and a prompt composed from excerpt + requested style + ratio. Do not invoke image generation during planning. Implement `renderIllustrationMarkdown(job, scenes)` with source metadata, configuration, prompt, generation status, and artifact/image references.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run src/server/skills/article-illustrations/article-source.test.ts src/server/skills/article-illustrations/illustration-planner.test.ts --pool=forks`

Expected: PASS.

- [ ] **Step 6: Commit the source/planning slice**

```bash
git add src/server/skills/article-illustrations/article-source.ts src/server/skills/article-illustrations/article-source.test.ts src/server/skills/article-illustrations/illustration-planner.ts src/server/skills/article-illustrations/illustration-planner.test.ts
git commit -m "feat(image): add article source and illustration planning"
```

## Task 3: Article Illustration Runtime and HTTP API

**Files:**
- Create: `src/server/skills/article-illustrations/article-illustration.service.ts`
- Create: `src/server/http/routes/article-illustrations.ts`
- Create: `src/server/http/routes/article-illustrations.test.ts`
- Modify: `src/server/http/app.ts`

- [ ] **Step 1: Write failing API integration tests**

Test the following lifecycle against `createHttpApp()`: upload/extract text; URL consent rejection; plan creation; eligible Package Skill list only when installation is enabled and the current manifest declares `image.generate`; fallback selection; scene update/add/remove; confirmation; retry; recovery list; Markdown export; and a failed fetch response with the safe fallback payload.

```ts
const created = await requestJson(app, '/article-illustrations/plans', { method: 'POST', body: JSON.stringify(planRequest) })
expect(created.data.status).toBe('waiting_approval')
const confirmed = await requestJson(app, `/article-illustrations/${created.data.id}/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision: 0 }) })
expect(confirmed.data.status).not.toBe('waiting_approval')
```

- [ ] **Step 2: Run the HTTP test and verify RED**

Run: `npx vitest run src/server/http/routes/article-illustrations.test.ts --pool=forks`

Expected: FAIL because the routes are not mounted.

- [ ] **Step 3: Implement service behavior**

Implement `listEligibleSkills`, `createPlan`, `updatePlan`, `confirmPlan`, `retryScene`, `getJob`, `listRecoverable`, and `exportMarkdown`.

- Package path: create a `skill_runs_v2` record with `surface: 'image'`, selected `skill_version_id`, source/scene/config input and linked `image_session_id`; persist the run ID and issue the confirm command only after edited scenes are persisted. Refresh Run/events/artifacts through existing Package Runtime APIs.
- Fallback path: create/reuse an Image Studio session, invoke `generateForSession()` once per confirmed scene, persist generation IDs and per-scene status, and allow retry with the edited prompt.
- Terminal summary: mark `completed` when all scenes succeed and `completed_with_errors` when one or more scenes fail while preserving successful generations.

- [ ] **Step 4: Implement route contract**

Mount routes below `/api/v1/article-illustrations`:

```text
POST /extract-text
POST /plans
GET  /skills
GET  /recoverable
GET  /:id
PATCH /:id/scenes/:sceneId
POST /:id/scenes
DELETE /:id/scenes/:sceneId
POST /:id/confirm
POST /:id/scenes/:sceneId/retry
GET  /:id/export/markdown
```

Use Zod for all JSON validation; use multipart form parsing only for document uploads; return `{ data }` on success and `{ error: { code, message } }` for all errors.

- [ ] **Step 5: Run HTTP tests and verify GREEN**

Run: `npx vitest run src/server/http/routes/article-illustrations.test.ts --pool=forks`

Expected: PASS.

- [ ] **Step 6: Commit the runtime/API slice**

```bash
git add src/server/skills/article-illustrations/article-illustration.service.ts src/server/http/routes/article-illustrations.ts src/server/http/routes/article-illustrations.test.ts src/server/http/app.ts
git commit -m "feat(image): add article illustration runtime api"
```

## Task 4: Renderer State and Article Workbench

**Files:**
- Create: `src/renderer/pages/ImageStudio/article-illustration.types.ts`
- Create: `src/renderer/pages/ImageStudio/article-illustration.store.ts`
- Create: `src/renderer/pages/ImageStudio/ArticleIllustrationWorkbench.tsx`
- Create: `src/renderer/pages/ImageStudio/article-illustration/ArticleSourceCard.tsx`
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationConfigCard.tsx`
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationPlanEditor.tsx`
- Create: `src/renderer/pages/ImageStudio/article-illustration/IllustrationRunPanel.tsx`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/pages/ImageStudio/index.tsx`
- Modify: `src/renderer/styles/global.css`
- Test: `src/renderer/pages/ImageStudio/article-illustration.store.test.ts`

- [ ] **Step 1: Write failing renderer-state tests**

Mock only the `platform.articleIllustrations` API boundary. Assert that URL extraction cannot be dispatched until consent is true, source extraction failure preserves the URL and switches the UI to paste fallback, a plan edit survives local refresh, confirmation moves the job out of `waiting_approval`, and recovery loads unfinished jobs.

```ts
await store.extractUrl()
expect(store.error?.code).toBe('URL_CONSENT_REQUIRED')
store.updateScene(scene.id, { prompt: '修订后的提示词' })
expect(store.scenes[0].prompt).toBe('修订后的提示词')
```

- [ ] **Step 2: Run renderer-state test and verify RED**

Run: `npx vitest run src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks`

Expected: FAIL because the article store does not exist.

- [ ] **Step 3: Add typed client and isolated Zustand store**

Add `platform.articleIllustrations` methods for every HTTP endpoint. The store state must include mode, source draft, URL-consent flag, extracted article, eligible skills, selected execution mode, image count/configuration, capability/budget summary, plan scenes, active job, recoverable jobs, loading flags, and structured errors. Keep this state separate from `useImageStore` so existing single-image sessions are untouched.

- [ ] **Step 4: Implement the workbench components**

- `ArticleSourceCard`: textarea, URL input with an explicit consent checkbox/message, file input restricted to `.md,.txt,.docx,.pdf`, and a paste fallback action after fetch failure.
- `IllustrationConfigCard`: Package Skill selector limited to the server-provided eligible list, explicit fallback option, count `1..12`, and existing model/ratio/style controls.
- `IllustrationPlanEditor`: add/delete/edit/reorder scenes; disable confirm while the plan is empty or saving; show requested/active permissions and predicted image calls.
- `IllustrationRunPanel`: map every fallback scene generation into the existing `GenerationCard`, show Package Run state/events/artifacts, offer single-scene retry, resume waiting/interrupted jobs, and download Markdown/images through the exposed API.
- `index.tsx`: render mode toggle; render the existing `ImageSessionList`/`ImageChatPanel` path unchanged for single image and the new workbench for article mode.

- [ ] **Step 5: Add responsive styles and accessibility semantics**

Add labelled tabs, labelled controls, `aria-live` status for extraction and batch progress, visible consent copy, keyboard-accessible scene buttons, and a narrow-layout single-column workbench without modifying existing chat-panel styles.

- [ ] **Step 6: Run renderer-state test and verify GREEN**

Run: `npx vitest run src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks`

Expected: PASS.

- [ ] **Step 7: Commit the renderer slice**

```bash
git add src/renderer/api/index.ts src/renderer/pages/ImageStudio src/renderer/styles/global.css
git commit -m "feat(image): add article illustration workbench"
```

## Task 5: Acceptance, Documentation, and Regression Safety

**Files:**
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md`
- Test: `src/server/http/routes/article-illustrations.test.ts`
- Test: `src/server/skills/article-illustrations/article-source.test.ts`
- Test: `src/server/skills/article-illustrations/illustration-planner.test.ts`
- Test: `src/server/db/repositories/article-illustration.repo.test.ts`
- Test: `src/renderer/pages/ImageStudio/article-illustration.store.test.ts`

- [ ] **Step 1: Run focused feature suite**

Run:

```bash
npx vitest run src/server/db/repositories/article-illustration.repo.test.ts src/server/skills/article-illustrations/article-source.test.ts src/server/skills/article-illustrations/illustration-planner.test.ts src/server/http/routes/article-illustrations.test.ts src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run existing image and Package Runtime regression tests**

Run:

```bash
npx vitest run src/server/llm/media/image.test.ts src/server/skills/adapters/image-studio-capability-adapter.test.ts src/server/http/routes/skill-package-runtime.test.ts --pool=forks
```

Expected: all tests pass.

- [ ] **Step 3: Run static and production checks**

Run:

```bash
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0; record the existing bundle-size warning separately if emitted.

- [ ] **Step 4: Update only completed TODO 15 items**

Check all sixteen TODO 15 items only when the focused suite, regressions, typecheck, and build are green. Do not modify TODO 16–18.

- [ ] **Step 5: Commit acceptance bookkeeping**

```bash
git add docs/skills/skill-package-runtime-b-lite-implementation-todo.md
git commit -m "docs(skills): complete article illustration todo"
```

## Coverage Review

- Mode switch and preservation of legacy single-image path: Task 4.
- Pasted text, consented URL, URL fallback, and MD/DOCX/PDF/TXT inputs: Tasks 2–4.
- Package Skill selection plus existing-model fallback: Tasks 3–4.
- Image count/configuration, permissions, and budget: Tasks 3–4.
- Editable/add/delete/reorder plan followed by confirmation: Tasks 2–4.
- Run progress, `GenerationCard`, retry, export, and recovery: Tasks 3–4.
- Persistence, error boundaries, migration, regression, typecheck, and build: Tasks 1 and 5.
