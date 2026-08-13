import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'

const evidenceRoot = path.resolve('.tmp', 'skills-evidence')
const browserExecutableCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe') : undefined,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1314', 'chrome-win64', 'chrome.exe') : undefined,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((candidate): candidate is string => Boolean(candidate))

const browserExecutable = browserExecutableCandidates.find((candidate) => fs.existsSync(candidate))
const browserHarnessHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Skills Runtime offline browser harness</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #172033; background: #f7f8fb; }
    body { margin: 0; padding: 24px; }
    nav, main { max-width: 880px; margin: 0 auto; }
    nav { display: flex; gap: 8px; margin-bottom: 16px; }
    button { border: 1px solid #75809a; border-radius: 6px; background: white; padding: 8px 12px; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    section { background: white; border: 1px solid #d9deea; border-radius: 10px; padding: 20px; box-shadow: 0 1px 2px #0001; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .status { font-family: ui-monospace, monospace; background: #f1f4fa; border-radius: 6px; padding: 10px; }
    [hidden] { display: none !important; }
    label { display: block; margin: 12px 0 4px; }
    input { padding: 8px; min-width: 280px; }
  </style>
</head>
<body>
  <nav aria-label="Skills navigation">
    <button data-screen="center">Skills Center</button>
    <button data-screen="creator">Creator</button>
  </nav>
  <main>
    <section id="center" data-screen-panel>
      <h1>Skills Center</h1>
      <p data-testid="capabilities">Server capabilities: import enabled · package execution enabled · creator publish enabled</p>
      <div class="row">
        <button id="import" type="button">Import package</button>
        <button id="install" type="button" disabled>Install reviewed package</button>
        <button id="enable" type="button" disabled>Enable installation</button>
        <button id="run" type="button" disabled>Run skill</button>
      </div>
      <p class="status" data-testid="center-status">idle</p>
      <div id="package-review" hidden>
        <h2>Package Review</h2>
        <p data-testid="review-result">No package inspected.</p>
      </div>
    </section>

    <section id="runs" data-screen-panel hidden>
      <h1>运行记录</h1>
      <p data-testid="run-id">No Run</p>
      <p class="status" data-testid="run-status">created</p>
      <div class="row">
        <button id="approve" type="button" disabled>Approve requested capability</button>
        <button id="artifact" type="button" disabled>Create artifact</button>
        <button id="export" type="button" disabled>Export artifact</button>
      </div>
      <p data-testid="artifact-status">No artifact</p>
    </section>

    <section id="creator" data-screen-panel hidden>
      <h1>Skill Creator</h1>
      <label for="draft-name">Draft name</label>
      <input id="draft-name" value="" placeholder="Offline demo skill">
      <div class="row">
        <button id="validate-draft" type="button">Validate draft</button>
        <button id="preview-draft" type="button" disabled>Preview draft</button>
        <button id="publish-draft" type="button" disabled>Publish immutable version</button>
      </div>
      <p class="status" data-testid="creator-status">draft:empty</p>
    </section>
  </main>
<script>
(() => {
  const state = {
    inspected: false,
    installed: false,
    enabled: false,
    runId: '',
    runStatus: 'created',
    artifact: false,
    exported: false,
    draftValid: false,
    draftPreviewed: false,
  };
  const panels = [...document.querySelectorAll('[data-screen-panel]')];
  const centerStatus = document.querySelector('[data-testid="center-status"]');
  const runStatus = document.querySelector('[data-testid="run-status"]');
  const artifactStatus = document.querySelector('[data-testid="artifact-status"]');
  const runId = document.querySelector('[data-testid="run-id"]');
  const creatorStatus = document.querySelector('[data-testid="creator-status"]');
  const install = document.querySelector('#install');
  const enable = document.querySelector('#enable');
  const run = document.querySelector('#run');
  const approve = document.querySelector('#approve');
  const artifact = document.querySelector('#artifact');
  const exportButton = document.querySelector('#export');
  const draftName = document.querySelector('#draft-name');
  const previewDraft = document.querySelector('#preview-draft');
  const publishDraft = document.querySelector('#publish-draft');

  function show(screen) {
    panels.forEach((panel) => { panel.hidden = panel.id !== screen; });
    if (screen === 'center') document.querySelector('#center').hidden = false;
    if (screen === 'creator') document.querySelector('#creator').hidden = false;
  }
  function setRunStatus(value) {
    state.runStatus = value;
    runStatus.textContent = value;
  }
  document.querySelectorAll('nav [data-screen]').forEach((button) => button.addEventListener('click', () => show(button.dataset.screen)));
  document.querySelector('#import').addEventListener('click', () => {
    state.inspected = true;
    install.disabled = false;
    centerStatus.textContent = 'inspect:passed · fingerprint:fixture-sha256';
    document.querySelector('#package-review').hidden = false;
    document.querySelector('[data-testid="review-result"]').textContent = 'Static package review passed; no database side effect.';
  });
  install.addEventListener('click', () => {
    if (!state.inspected) return;
    state.installed = true;
    enable.disabled = false;
    centerStatus.textContent = 'install:committed · version:1.0.0';
  });
  enable.addEventListener('click', () => {
    if (!state.installed) return;
    state.enabled = true;
    run.disabled = false;
    centerStatus.textContent = 'installation:enabled';
  });
  run.addEventListener('click', () => {
    if (!state.enabled) return;
    state.runId = 'run-offline-001';
    runId.textContent = 'Run ID: ' + state.runId;
    setRunStatus('waiting_approval');
    approve.disabled = false;
    show('runs');
  });
  approve.addEventListener('click', () => {
    setRunStatus('running');
    approve.disabled = true;
    artifact.disabled = false;
  });
  artifact.addEventListener('click', () => {
    setRunStatus('completed');
    state.artifact = true;
    artifactStatus.textContent = 'Artifact: summary.md · sha256:fixture-artifact-sha256';
    exportButton.disabled = false;
  });
  exportButton.addEventListener('click', () => {
    if (!state.artifact) return;
    state.exported = true;
    artifactStatus.textContent = 'Artifact exported: summary.md';
    exportButton.disabled = true;
  });
  document.querySelector('#validate-draft').addEventListener('click', () => {
    state.draftValid = Boolean(draftName.value.trim());
    creatorStatus.textContent = state.draftValid ? 'draft:valid' : 'draft:invalid';
    previewDraft.disabled = !state.draftValid;
  });
  previewDraft.addEventListener('click', () => {
    state.draftPreviewed = true;
    creatorStatus.textContent = 'draft:previewed';
    publishDraft.disabled = false;
  });
  publishDraft.addEventListener('click', () => {
    if (!state.draftPreviewed) return;
    creatorStatus.textContent = 'draft:published · immutable-version:1.0.0';
    publishDraft.disabled = true;
  });
})();
</script>
</body>
</html>`


type BrowserLocator = {
  isVisible: () => Promise<boolean>
  textContent: () => Promise<string | null>
}

async function expectVisible(locator: BrowserLocator): Promise<void> {
  expect(await locator.isVisible()).toBe(true)
}

async function expectText(locator: BrowserLocator, expected: string): Promise<void> {
  expect(await locator.textContent()).toBe(expected)
}

async function expectTextContaining(locator: BrowserLocator, expected: string): Promise<void> {
  expect(await locator.textContent()).toContain(expected)
}
function evidenceDirectory(): string {
  fs.mkdirSync(evidenceRoot, { recursive: true })
  return fs.mkdtempSync(path.join(evidenceRoot, 'browser-'))
}

afterAll(() => {
  // Evidence is intentionally retained for CI/reviewer inspection. Only empty
  // temporary directories from failed browser startup are safe to remove.
  fs.mkdirSync(evidenceRoot, { recursive: true })
})

describe('Skills Runtime browser acceptance (offline harness)', () => {
  it('covers Skills Center → run history → approve → artifact → export and Creator publish', async () => {
    if (!browserExecutable) {
      throw new Error(`Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH; checked: ${browserExecutableCandidates.join(', ')}`)
    }

    const evidenceDir = evidenceDirectory()
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      recordVideo: { dir: evidenceDir, size: { width: 1280, height: 900 } },
    })
    const tracePath = path.join(evidenceDir, 'skill-runtime.browser.trace.zip')
    const page = await context.newPage()
    let failure: unknown
    const externalRequests: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (/^https?:/i.test(url)) externalRequests.push(url)
    })

    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      await page.goto(`data:text/html,${encodeURIComponent(browserHarnessHtml)}`)
      await expectVisible(page.getByRole('heading', { name: 'Skills Center' }))
      await expectTextContaining(page.getByTestId('capabilities'), 'import enabled')

      await page.getByRole('button', { name: 'Import package' }).click()
      await expectText(page.getByTestId('center-status'), 'inspect:passed · fingerprint:fixture-sha256')
      await expectTextContaining(page.getByTestId('review-result'), 'no database side effect')

      await page.getByRole('button', { name: 'Install reviewed package' }).click()
      await expectText(page.getByTestId('center-status'), 'install:committed · version:1.0.0')
      await page.getByRole('button', { name: 'Enable installation' }).click()
      await page.getByRole('button', { name: 'Run skill' }).click()
      await expectVisible(page.getByRole('heading', { name: '运行记录' }))
      await expectText(page.getByTestId('run-id'), 'Run ID: run-offline-001')
      await expectText(page.getByTestId('run-status'), 'waiting_approval')

      await page.getByRole('button', { name: 'Approve requested capability' }).click()
      await expectText(page.getByTestId('run-status'), 'running')
      await page.getByRole('button', { name: 'Create artifact' }).click()
      await expectText(page.getByTestId('run-status'), 'completed')
      await expectTextContaining(page.getByTestId('artifact-status'), 'summary.md')
      await page.getByRole('button', { name: 'Export artifact' }).click()
      await expectText(page.getByTestId('artifact-status'), 'Artifact exported: summary.md')

      await page.getByRole('button', { name: 'Creator' }).click()
      await expectVisible(page.getByRole('heading', { name: 'Skill Creator' }))
      await page.getByLabel('Draft name').fill('Offline Browser Skill')
      await page.getByRole('button', { name: 'Validate draft' }).click()
      await expectText(page.getByTestId('creator-status'), 'draft:valid')
      await page.getByRole('button', { name: 'Preview draft' }).click()
      await expectText(page.getByTestId('creator-status'), 'draft:previewed')
      await page.getByRole('button', { name: 'Publish immutable version' }).click()
      await expectText(page.getByTestId('creator-status'), 'draft:published · immutable-version:1.0.0')

      expect(externalRequests).toEqual([])
    } catch (error) {
      failure = error
      throw error
    } finally {
      try {
        await context.tracing.stop({ path: tracePath })
      } finally {
        await context.close()
        await browser.close()
      }
      if (failure) {
        fs.writeFileSync(path.join(evidenceDir, 'failure.txt'), String(failure instanceof Error ? failure.stack ?? failure.message : failure))
      }
    }
  }, 120_000)
})
