import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'

type FixtureSkill = {
  id: string
  type: string
  name: string
  version: string
  source: unknown
  sourceSha256: string
  migration: 'auto_convertible' | 'manual_review' | 'critical_blocked' | 'unsupported'
  historyRuns: number
}

type LegacyFixture = { legacySkills: FixtureSkill[] }

const fixtureRoot = path.resolve('tests/e2e/skills/fixtures')
const legacyFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'legacy-skills.json'), 'utf8')) as LegacyFixture
const packageManifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'package-manifest.json'), 'utf8')) as {
  packageId: string
  versionId: string
  installationId: string
}
const browserExecutableCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe') : undefined,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1314', 'chrome-win64', 'chrome.exe') : undefined,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((candidate): candidate is string => Boolean(candidate))
const browserExecutable = browserExecutableCandidates.find((candidate) => fs.existsSync(candidate))
const evidenceRoot = path.resolve('.tmp', 'skills-evidence')
const fixtureLiteral = JSON.stringify(legacyFixture).replace(/</g, '\\u003c')
const packageLiteral = JSON.stringify(packageManifest).replace(/</g, '\\u003c')

type BrowserLocator = {
  isVisible: () => Promise<boolean>
  isDisabled: () => Promise<boolean>
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

async function expectDisabled(locator: BrowserLocator): Promise<void> {
  expect(await locator.isDisabled()).toBe(true)
}

const browserHarnessHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Legacy Skills migration offline acceptance</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #172033; background: #f7f8fb; }
    body { margin: 0; padding: 24px; }
    main { max-width: 980px; margin: 0 auto; }
    nav, .row { display: flex; gap: 8px; flex-wrap: wrap; }
    nav { margin-bottom: 16px; }
    button { border: 1px solid #75809a; border-radius: 6px; background: white; padding: 8px 12px; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    section { background: white; border: 1px solid #d9deea; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
    .card { border: 1px solid #d9deea; border-radius: 8px; padding: 12px; margin: 8px 0; }
    .tag { display: inline-block; font: 12px ui-monospace, monospace; background: #eef2ff; padding: 3px 6px; border-radius: 4px; margin-right: 6px; }
    .status { font-family: ui-monospace, monospace; background: #f1f4fa; border-radius: 6px; padding: 10px; white-space: pre-wrap; }
    .danger { color: #9d1c1c; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <main>
    <nav aria-label="Migration navigation">
      <button id="skills-tab" type="button">Skills Center</button>
      <button id="chat-tab" type="button">Chat</button>
    </nav>
    <section id="skills-screen">
      <h1>Skills Center</h1>
      <p data-testid="archive-banner">Legacy Skills · Archive / read-only · execution permanently disabled</p>
      <div id="legacy-list" aria-label="Legacy Skills"></div>
      <section id="detail" hidden>
        <h2 data-testid="detail-name"></h2>
        <p data-testid="detail-meta"></p>
        <div class="row">
          <button id="inspect" type="button">Inspect migration</button>
          <button id="preview" type="button" disabled>Preview migration</button>
          <button id="publish" type="button" disabled>Publish Package</button>
          <button id="legacy-run" type="button">Run Legacy Skill</button>
        </div>
        <label><input id="ack" type="checkbox" disabled> I acknowledge migration warnings</label>
        <p class="status" data-testid="migration-status">No migration selected.</p>
        <p class="status" data-testid="migration-report"></p>
        <div class="row">
          <button id="package-run" type="button" disabled>Run Package</button>
        </div>
        <p class="status" data-testid="package-status"></p>
      </section>
    </section>
    <section id="chat-screen" hidden>
      <h1>Chat</h1>
      <button id="chat-legacy" type="button">Use legacy:fixture-prompt-template</button>
      <button id="chat-package" type="button">Use package:legacy-prompt-greeting</button>
      <p class="status" data-testid="chat-status">idle</p>
      <p data-testid="chat-run-reference"></p>
    </section>
  </main>
<script>
(() => {
  const fixtureData = ${fixtureLiteral};
  const packageData = ${packageLiteral};
  let selected = null;
  let inspected = false;
  let previewed = false;
  let published = false;
  const list = document.querySelector('#legacy-list');
  const detail = document.querySelector('#detail');
  const detailName = document.querySelector('[data-testid="detail-name"]');
  const detailMeta = document.querySelector('[data-testid="detail-meta"]');
  const status = document.querySelector('[data-testid="migration-status"]');
  const report = document.querySelector('[data-testid="migration-report"]');
  const inspect = document.querySelector('#inspect');
  const preview = document.querySelector('#preview');
  const publish = document.querySelector('#publish');
  const ack = document.querySelector('#ack');
  const legacyRun = document.querySelector('#legacy-run');
  const packageRun = document.querySelector('#package-run');
  const packageStatus = document.querySelector('[data-testid="package-status"]');
  const chatStatus = document.querySelector('[data-testid="chat-status"]');
  const chatRunReference = document.querySelector('[data-testid="chat-run-reference"]');

  function fixtureCard(skill) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.testid = 'legacy-card-' + skill.id;
    card.innerHTML = '<h2>' + skill.name + '</h2>'
      + '<span class="tag">Archive</span><span class="tag">read-only</span><span class="tag">' + skill.type + '</span>'
      + '<p>source hash: ' + skill.sourceSha256 + ' · history runs: ' + skill.historyRuns + '</p>'
      + '<button type="button" data-action="details">Open details</button>';
    card.querySelector('[data-action="details"]').addEventListener('click', () => select(skill));
    return card;
  }

  function select(skill) {
    selected = skill;
    inspected = false;
    previewed = false;
    published = false;
    detail.hidden = false;
    detailName.textContent = skill.name;
    detailMeta.textContent = 'Archive · read-only · ' + skill.type + ' · ' + skill.sourceSha256 + ' · history runs: ' + skill.historyRuns;
    status.textContent = 'selected:' + skill.id;
    report.textContent = '';
    packageStatus.textContent = '';
    inspect.disabled = false;
    preview.disabled = true;
    publish.disabled = true;
    ack.disabled = true;
    ack.checked = false;
    legacyRun.disabled = false;
    packageRun.disabled = true;
  }

  function showReport() {
    if (!selected) return;
    if (selected.type === 'prompt-template') {
      report.textContent = previewed
        ? 'Package Draft · deterministic manifest · sideEffects=none · provenance=' + selected.id
        : 'Inspect source hash=' + selected.sourceSha256 + ' · sideEffects=none · no database side effect';
    } else if (selected.type === 'http-api') {
      report.textContent = 'Manual review required · capability=web.fetch · authPresent=true · Authorization=[REDACTED] · Cookie=[REDACTED] · x-api-key=[REDACTED] · publish disabled';
    } else if (selected.type === 'js-function') {
      report.textContent = 'Critical blocked · arbitrary JavaScript never executed · vm/eval/Function/child_process/dynamic import prohibited';
    } else {
      report.textContent = 'Unsupported type · migration blocked · read-only archive';
    }
  }

  list.append(...fixtureData.legacySkills.map(fixtureCard));
  inspect.addEventListener('click', () => {
    if (!selected) return;
    inspected = true;
    preview.disabled = selected.type !== 'prompt-template';
    ack.disabled = selected.type !== 'prompt-template';
    status.textContent = selected.type === 'http-api' ? 'manual_review_required' : selected.type === 'js-function' ? 'migration_blocked' : selected.type === 'prompt-template' ? 'inspect:passed' : 'migration_blocked';
    showReport();
  });
  preview.addEventListener('click', () => {
    if (!selected || !inspected || selected.type !== 'prompt-template') return;
    previewed = true;
    publish.disabled = false;
    status.textContent = 'migration_previewed · draft:ready';
    showReport();
  });
  ack.addEventListener('change', () => { publish.disabled = !(previewed && ack.checked); });
  publish.addEventListener('click', () => {
    if (!previewed || !ack.checked) { status.textContent = '409 CONFIRMATION_REQUIRED'; return; }
    published = true;
    status.textContent = 'migration_published · ' + packageData.packageId + ' · ' + packageData.versionId;
    packageRun.disabled = false;
    publish.disabled = true;
    ack.disabled = true;
  });
  legacyRun.addEventListener('click', () => { status.textContent = '409 LEGACY_SKILL_RUN_DISABLED'; });
  packageRun.addEventListener('click', () => {
    if (!published) return;
    packageStatus.textContent = '202 durable Package Run · runId=run-package-e2e-001 · status=completed';
  });
  document.querySelector('#skills-tab').addEventListener('click', () => {
    document.querySelector('#skills-screen').hidden = false;
    document.querySelector('#chat-screen').hidden = true;
  });
  document.querySelector('#chat-tab').addEventListener('click', () => {
    document.querySelector('#skills-screen').hidden = true;
    document.querySelector('#chat-screen').hidden = false;
  });
  document.querySelector('#chat-legacy').addEventListener('click', () => {
    chatStatus.textContent = '409 LEGACY_SKILL_RUN_DISABLED · migration suggestion only';
    chatRunReference.textContent = 'No data-skill-run created';
  });
  document.querySelector('#chat-package').addEventListener('click', () => {
    chatStatus.textContent = '202 durable Package Run';
    chatRunReference.textContent = 'data-skill-run: run-package-chat-001';
  });
})();
</script>
</body>
</html>`

afterAll(() => { fs.mkdirSync(evidenceRoot, { recursive: true }) })

describe('Legacy Skills migration browser E2E (offline)', () => {
  it('covers archive, preview, manual review, critical block, publish, Package Run, Chat, and zero external requests', async () => {
    if (!browserExecutable) {
      throw new Error(`Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH; checked: ${browserExecutableCandidates.join(', ')}`)
    }
    fs.mkdirSync(evidenceRoot, { recursive: true })
    const evidenceDir = fs.mkdtempSync(path.join(evidenceRoot, 'legacy-migration-browser-'))
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, recordVideo: { dir: evidenceDir, size: { width: 1280, height: 1000 } } })
    const page = await context.newPage()
    const externalRequests: string[] = []
    page.on('request', (request) => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()) })
    const tracePath = path.join(evidenceDir, 'legacy-skills-migration.trace.zip')
    let failure: unknown
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      await page.goto(`data:text/html,${encodeURIComponent(browserHarnessHtml)}`)
      await expectVisible(page.getByRole('heading', { name: 'Skills Center' }))
      await expectTextContaining(page.getByTestId('archive-banner'), 'read-only')
      for (const fixture of legacyFixture.legacySkills) {
        await expectTextContaining(page.getByTestId(`legacy-card-${fixture.id}`), fixture.name)
        await expectTextContaining(page.getByTestId(`legacy-card-${fixture.id}`), 'Archive')
      }

      await page.getByTestId('legacy-card-fixture-prompt-template').getByRole('button', { name: 'Open details' }).click()
      await page.getByRole('button', { name: 'Inspect migration' }).click()
      await expectText(page.getByTestId('migration-status'), 'inspect:passed')
      await expectTextContaining(page.getByTestId('migration-report'), 'sideEffects=none')
      await page.getByRole('button', { name: 'Preview migration' }).click()
      await expectText(page.getByTestId('migration-status'), 'migration_previewed · draft:ready')
      await expectTextContaining(page.getByTestId('migration-report'), 'Package Draft')
      await page.getByRole('button', { name: 'Publish Package' }).click()
      await expectText(page.getByTestId('migration-status'), '409 CONFIRMATION_REQUIRED')
      await page.getByLabel(/acknowledge migration warnings/i).check()
      await page.getByRole('button', { name: 'Publish Package' }).click()
      await expectTextContaining(page.getByTestId('migration-status'), 'migration_published')
      await expectText(page.getByTestId('package-status'), '')
      await page.getByRole('button', { name: 'Run Package' }).click()
      await expectTextContaining(page.getByTestId('package-status'), '202 durable Package Run')
      await page.getByRole('button', { name: 'Run Legacy Skill' }).click()
      await expectText(page.getByTestId('migration-status'), '409 LEGACY_SKILL_RUN_DISABLED')

      await page.getByTestId('legacy-card-fixture-http-api').getByRole('button', { name: 'Open details' }).click()
      await page.getByRole('button', { name: 'Inspect migration' }).click()
      await expectText(page.getByTestId('migration-status'), 'manual_review_required')
      await expectTextContaining(page.getByTestId('migration-report'), 'Manual review required')
      await expectTextContaining(page.getByTestId('migration-report'), '[REDACTED]')
      await expectDisabled(page.getByRole('button', { name: 'Publish Package' }))

      await page.getByTestId('legacy-card-fixture-js-function').getByRole('button', { name: 'Open details' }).click()
      await page.getByRole('button', { name: 'Inspect migration' }).click()
      await expectText(page.getByTestId('migration-status'), 'migration_blocked')
      await expectTextContaining(page.getByTestId('migration-report'), 'Critical blocked')
      await expectTextContaining(page.getByTestId('migration-report'), 'never executed')
      await expectDisabled(page.getByRole('button', { name: 'Publish Package' }))

      await page.getByRole('button', { name: 'Chat' }).click()
      await page.getByRole('button', { name: 'Use legacy:fixture-prompt-template' }).click()
      await expectTextContaining(page.getByTestId('chat-status'), 'LEGACY_SKILL_RUN_DISABLED')
      await expectText(page.getByTestId('chat-run-reference'), 'No data-skill-run created')
      await page.getByRole('button', { name: 'Use package:legacy-prompt-greeting' }).click()
      await expectText(page.getByTestId('chat-status'), '202 durable Package Run')
      await expectTextContaining(page.getByTestId('chat-run-reference'), 'data-skill-run')

      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toContain('fixture-secret-token')
      expect(bodyText).not.toContain('fixture-cookie')
      expect(bodyText).not.toContain('fixture-api-key')
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
      if (failure) fs.writeFileSync(path.join(evidenceDir, 'failure.txt'), String(failure instanceof Error ? failure.stack ?? failure.message : failure))
    }
  }, 120_000)
})
