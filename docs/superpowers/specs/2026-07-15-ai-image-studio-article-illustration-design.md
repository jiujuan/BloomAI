# AI Image Studio Article Illustration Mode Design

**Date:** 2026-07-15
**Scope:** TODO 15 — AI Image Studio article illustration mode
**Status:** Approved for implementation

## 1. Goal

Add an article illustration workflow to Image Studio without changing the existing single-image workflow. Users provide an article through pasted text, a URL, or an uploaded MD/DOCX/PDF/TXT file; review an editable illustration plan; and confirm a batch generation run. Package Skills with `image.generate` are preferred, while the existing Image Studio model generation path remains an available fallback.

## 2. User Flow

1. Select `Single image` or `Article illustration` mode.
2. In article mode, choose a source:
   - Paste article text.
   - Submit a URL after explicitly consenting to server-side fetch and extraction.
   - Upload a supported document.
3. Choose an eligible installed Package Skill, or select the existing image model fallback.
4. Configure desired image count, aspect ratio, style, and model.
5. Review requested capabilities, active grants, applicable image budget, and estimated calls.
6. Generate an illustration plan consisting of editable scenes.
7. Add, edit, delete, or reorder scenes, then confirm batch generation.
8. Observe per-scene status and generated results through the existing `GenerationCard` presentation.
9. Retry a failed scene, export generated images and a Markdown manifest, or resume an awaiting-confirmation/interrupted run.

## 3. Source Handling

### 3.1 Pasted text

The client sends article text to a server-side parser with explicit limits. The server returns normalized content plus metadata suitable for planning.

### 3.2 URL

Before fetching, the UI presents an explicit permission notice that the server will retrieve and extract the supplied URL. On consent, the server fetches and converts the article to bounded plain text. If fetching fails, the UI retains the URL, surfaces a safe error, and offers an immediate switch to pasted text.

### 3.3 File uploads

Supported formats are MD, TXT, DOCX, and PDF. Files are parsed server-side. The resulting normalized article text is used for planning; local file paths are not passed to Package Skills.

## 4. Runtime Strategy

### 4.1 Preferred Package Skill path

Eligible skills are installed, enabled Package Skills that declare `image.generate`. The selection panel shows package/version, required capabilities, active grants, configured image limits, and the estimated number of calls.

Planning creates a persisted Package Run that is allowed to stop at `waiting_approval`. Confirming the editable scene plan emits the Run command that starts batch execution. The UI polls/refreshes Run records, events, and artifacts to support progress, error visibility, and recovery after restart.

### 4.2 Existing image-model fallback

If no eligible Package Skill is available or the user explicitly chooses the fallback, the app uses the existing Image Studio model configuration and generation endpoints. The article workflow still owns its plan and per-scene status, but result cards reuse the existing `GenerationCard` component.

## 5. UI Architecture

The Image Studio keeps its existing single-image components intact. Article illustration mode adds a dedicated workbench with these sections:

- Mode selector.
- Source input card (paste, URL, upload).
- Skill/model configuration card.
- Permission and image-budget summary.
- Editable scene plan.
- Batch run progress and result grid.
- Resume, retry, and export actions.

A dedicated Zustand state module owns article source, selection/configuration, plan, active Run reference, per-scene state, and recoverable tasks. It should not mutate existing single-image session state directly.

## 6. Data and API Boundaries

Add server APIs for article source extraction, eligible illustration-skill discovery, plan creation/updates, and export metadata. Reuse Package Runtime APIs for Run records, commands, events, and artifacts. Reuse existing image-generation records/endpoints for fallback output.

The client does not receive credentials or filesystem paths. URL fetching is consent-gated. The server enforces input size/type limits and reports structured validation/fetch errors.

## 7. Testing and Acceptance

- Unit tests for source validation, plan normalization, image budget calculation, and Markdown export.
- API tests for URL consent/parse failures, document type validation, plan creation/update, confirmation, retry, and export.
- UI/state tests for mode transition, source fallback, skill/model selection, plan editing, and recovery-state hydration.
- Typecheck, targeted tests, production build, and a runtime UI check where browser tooling is available.

## 8. Explicit Non-goals

- Chat page handoff is TODO 16 and remains out of scope.
- The feature does not send local file paths to third-party skills.
- The feature does not change existing single-image generation semantics.
