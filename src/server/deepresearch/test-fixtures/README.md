# Deep Research DRQ-11 fixtures and manual real-model acceptance

## What is committed

- `market.json`, `competitor.json`, `academic.json`, and `general.json` are the deterministic, offline workflow fixtures. They exercise the complete pipeline and keep assertions structural rather than relying on a model's exact prose.
- `sales-lead-agent-quality.json` is a copyright-safe synthetic golden corpus for the historic **market / sales-lead Agent** topic. It includes primary product/docs material, association and independent research, off-topic news, a canonical duplicate, navigation noise, CAPTCHA, a short page, and two conflicting observations.
- `quality-corpus.test.ts` applies the real source curator and main-content extractor to that corpus. It proves that relevant sources survive, generic news and duplicates are rejected, noisy pages are blocked, and conflicts remain separate passages.
- `real-model-e2e.test.ts` is deliberately opt-in. It calls the normal configured-model path while replacing only search/fetch with the fixed corpus. It is excluded from ordinary local/CI test runs.

All fixture text is original synthetic content. Do not replace it with copied publisher page bodies.

## Controlled integration suite

Run the offline suite:

```powershell
npm test -- src/server/deepresearch/deep-research.acceptance.test.ts src/server/deepresearch/test-fixtures/quality-corpus.test.ts
```

The acceptance workflow asserts persisted questions, queries, curated sources, snapshots, evidence, report sections/claims/citations, JSON/Markdown artifacts, quality assessment events, cancellation, clarification resume, and restart recovery. The existing iteration tests retain the `06b63d2` reservation boundary; section-evidence/report tests retain `d3be4a0` question-and-section routing plus title + URL references.

## Protected real-model E2E

Only an administrator may run this test, and only against a **dedicated disposable DATA_DIR** that already has an enabled backend text model and credentials (for example an enabled Agnes or DeepSeek model). Never point it at a developer's normal production-like data directory.

Before invoking it, choose and record an approved **total token ceiling**. The test stores and prints the newly created Run ID, asserts a secret-free model snapshot is visible, and asserts total recorded tokens are non-zero and do not exceed the declared ceiling.

```powershell
$env:DEEP_RESEARCH_REAL_MODEL_E2E = '1'
$env:DEEP_RESEARCH_REAL_MODEL_E2E_DATA_DIR = 'D:\safe\bloomai-deep-research-e2e'
$env:DEEP_RESEARCH_REAL_MODEL_E2E_MAX_TOKENS = '12000'
npm test -- src/server/deepresearch/real-model-e2e.test.ts
```

The ceiling is a post-run guard because provider pricing/usage availability varies; use the smallest permitted `standard` Run and provider-side spend limits as the preventative control. The test does not run automatically and does not print credentials or source bodies.

## Manual acceptance record

Create **new** Runs; historical artifacts, including `bccf869c-7791-4568-afe8-db6ce4947a57`, are not rebuilt automatically. Record date, selected provider/model, declared token ceiling, returned Run ID, final status, and any provider error for each topic:

1. Market and sales-lead intelligence agents (the golden fixture topic above).
2. A market research topic.
3. A competitor or academic research topic.

For the sales-lead-agent report, verify each section answers a different part of the topic rather than repeating text, and that it includes product categories, technical stack, representative products/capabilities, deployment limitations, and readable clickable title + HTTP(S) references. If the quality gate returns `completed_with_limitations` or `failed`, record its gaps/remedial actions; do not accept it as a formal completed report.
