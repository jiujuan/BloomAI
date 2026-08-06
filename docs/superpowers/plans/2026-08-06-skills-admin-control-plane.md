# Skills Admin Control Plane v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, high-fidelity HTML prototype for the approved BloomAI Skills Runtime Control Plane v1.1 design, covering all thirteen pages and exactly three roles.

**Architecture:** Use one self-contained HTML file with embedded CSS and JavaScript. The shell owns navigation, Workbench/runtime context, role switching, theme switching, drawers, dialogs, toasts, filters, and state examples; page render functions provide each approved screen. The prototype is intentionally independent from the existing `skill-management-console-v1.1.html` and has no backend, build, network, or external asset dependency.

**Tech Stack:** HTML5, CSS custom properties, vanilla JavaScript, inline SVG icons using Lucide-style paths, local demo data.

---

## File map

- Create: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`
  - Contains the complete standalone prototype: design tokens, responsive layout, inline icons, role-scoped navigation, thirteen page renderers, state examples, drawers, dialogs, toasts, and theme switch.
- Read-only reference: `D:/codeproject/JS/bloomai/docs/skills/skill-admin-system-v1.1-design.md`
  - Source of truth for page inventory, terminology, roles, status colors, and acceptance criteria.
- Do not modify: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-management-console-v1.1.html`
  - Existing user prototype is unrelated to this redesign.

## Task 1: Create the standalone HTML shell and design tokens

**Files:**
- Create: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`

- [ ] **Step 1: Add the document shell and metadata.**

Include `<!doctype html>`, language metadata, viewport metadata, an accessible title, and a short no-JS fallback message. The page must open using `file://` without a server.

- [ ] **Step 2: Add BloomAI-compatible CSS tokens.**

Define light and dark custom properties for `#ffffff`, `#f5f5f4`, `#eeede9`, `#1a1a18`, `#3d3d3a`, `#73726c`, the `#7C6FF7 → #4B9BF5` brand gradient, and the approved status colors. Define 4/6/10/14px radii, compact spacing, focus rings, table density, drawer/dialog layers, and responsive breakpoints at 320px, 768px, 1024px, and 1440px.

- [ ] **Step 3: Add the accessible application shell.**

Create:

```html
<div class="app-shell">
  <aside id="sidebar" aria-label="Skills Runtime navigation"></aside>
  <main id="main-content" tabindex="-1"></main>
</div>
<div id="drawer-root"></div>
<div id="dialog-root"></div>
<div id="toast-root" aria-live="polite"></div>
```

Use real `button`, `a`, `input`, `select`, and `dialog` elements for interaction. Add a skip link and visible focus styles.

- [ ] **Step 4: Run a shell-only static check.**

Run:

```powershell
Select-String -LiteralPath 'docs/skills/ui/skill-admin-control-plane-v1.1.html' -Pattern '<!doctype html>|id="sidebar"|id="main-content"|id="drawer-root"|id="dialog-root"|id="toast-root"'
```

Expected: all five markers are found and the command exits `0`.

- [ ] **Step 5: Commit the shell checkpoint.**

```powershell
git add -- 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
git diff --cached --check
git commit -m "feat(skills-ui): scaffold v1.1 control plane prototype"
```

## Task 2: Implement role-scoped navigation and shared controls

**Files:**
- Modify: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`

- [ ] **Step 1: Define exactly three roles and their navigation.**

Use these role IDs and no additional roles:

```js
const roles = ['user', 'admin', 'ops'];
```

- `user`: Overview (personal), Package Catalog (available), Run Explorer (own), Run Detail (own), Artifact Center (own), Creator / Draft Studio (own), Approval Queue (own requests).
- `admin`: Overview, Package Catalog, Package Detail, Run Explorer, Run Detail, Approval Queue, Capability Policies, Artifact Center, Creator / Draft Studio, Legacy Skills, Audit & Evidence.
- `ops`: Overview, Run Explorer, Run Detail, Artifact Center, Runtime Diagnostics, Release & Migration, Audit & Evidence.

Use Chinese labels with domain terms retained: `Workbench`, `Run`, `Skill Package`, `Capability Grant`, `Artifact`, `Migration`.

- [ ] **Step 2: Add the top context bar.**

Render Workbench selector, Runtime status pill, schema version, worker count, queue depth, pending approvals, global search, role selector, theme toggle, and `暂停新 Run`. The button must be disabled with an explanatory tooltip for `user` and `admin` when the demo state says the action is ops-only.

- [ ] **Step 3: Add role switching and theme switching.**

Persist role and theme in in-memory state only. After switching roles, rerender navigation and the current page with filtered demo data. Toggle `data-theme="dark"` on `document.documentElement`; do not use `Workspace` in user-visible UI copy.

- [ ] **Step 4: Add shared status badges, icon helper, buttons, tables, metric cards, and empty/error/read-only banners.**

Every status badge must contain an inline icon, text, and color class. Do not use color alone to communicate state. Icon buttons must have `aria-label` and `title`.

- [ ] **Step 5: Run role and terminology checks.**

Run:

```powershell
$h = Get-Content -Raw 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
if (($h -notmatch "roles = \['user', 'admin', 'ops'\]") -or ($h -match 'Workspace 选择器|Workspace 下拉')) { throw 'ROLE_OR_TERM_CHECK_FAILED' }
'ROLE_TERM_CHECK=PASS'
```

Expected output: `ROLE_TERM_CHECK=PASS`.

- [ ] **Step 6: Commit the shared shell checkpoint.**

```powershell
git add -- 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
git diff --cached --check
git commit -m "feat(skills-ui): add roles and runtime shell controls"
```

## Task 3: Implement all thirteen page renderers

**Files:**
- Modify: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`

- [ ] **Step 1: Implement Runtime Overview.**

Render Runtime Health, Pending Approvals, Active Runs, Failure Budget, queue swimlane, Workbench health checklist, recent failed Runs, approvals, migrations, and events. Include healthy, queue backlog, degraded, and read-only examples.

- [ ] **Step 2: Implement Package Catalog and Package Detail.**

Catalog must include search, status/risk/source filters, Package/Runtime/Version/Installation/Capabilities/Risk/Status columns, import/create/export actions, and a quick drawer. Detail must include Overview, Versions, Installations, Capabilities, Runs, Artifacts, Audit tabs plus install/refresh/disable/delete/review actions.

- [ ] **Step 3: Implement Run Explorer and Run Detail.**

Explorer must display all approved state names and filters. Detail must show the state timeline, event stream, execution context, capability summary, and Artifact cards. Use an immutable `skillVersionId` and content hash in the visible data.

- [ ] **Step 4: Implement Approval Queue and Capability Policies.**

Approval Queue must show requested vs granted scope, risk, lifecycle, static scan result, and actions for once/session/persistent/reject. Capability Policies must expose a constrained form and impact preview rather than arbitrary JSON editing.

- [ ] **Step 5: Implement Artifact Center and Creator / Draft Studio.**

Artifact Center must show integrity, retention, ownership, orphan state, preview/download/export, and dry-run cleanup. Creator must show draft navigation, SKILL.md/manifest file tree, validation, capability review, security scan, diff, and publish gate.

- [ ] **Step 6: Implement Legacy Skills, Runtime Diagnostics, Release & Migration, and Audit & Evidence.**

Legacy must show compatibility and migration states. Diagnostics must show health, database/migration, feature flags, metrics, and diagnostic bundle redaction. Release & Migration must show six release stages, forward-fix-only migration, backup/restore rehearsal, worker drain, and rollback warnings. Audit must filter and export redacted events.

- [ ] **Step 7: Add page registry coverage check.**

Define a page registry with all thirteen IDs and render a visible page title for each. Run:

```powershell
$h = Get-Content -Raw 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
$ids = @('overview','packages','package-detail','runs','run-detail','approvals','capabilities','artifacts','creator','legacy','diagnostics','operations','audit')
foreach ($id in $ids) { if ($h -notmatch "['\"]$id['\"]") { throw "MISSING_PAGE_ID=$id" } }
'PAGE_REGISTRY_CHECK=PASS'
```

Expected output: `PAGE_REGISTRY_CHECK=PASS`.

- [ ] **Step 8: Commit the page checkpoint.**

```powershell
git add -- 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
git diff --cached --check
git commit -m "feat(skills-ui): add v1.1 control plane pages"
```

## Task 4: Implement drawers, dialogs, demo state changes, and accessibility

**Files:**
- Modify: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`

- [ ] **Step 1: Add the five required detail drawers.**

Implement Package, Run, Approval, Artifact, and Migration drawers with close buttons, `role="dialog"`, `aria-modal="true"`, title association, ESC close, backdrop close, and focus return to the opener.

- [ ] **Step 2: Add destructive and long-running confirmations.**

Implement confirmation dialogs for Approve, Reject, Cancel, Retry, Pause New Run, Orphan Cleanup Dry-run, and Rollback. Rollback dialog must state that database migrations are not rolled back. After confirmation, show a toast and update the local demo state.

- [ ] **Step 3: Add state demonstrators.**

Add a compact `演示状态` control for Loading, Empty, Partial failure, Read-only, Feature disabled, Permission denied, and populated states. It must update the current page without removing the shell or role context.

- [ ] **Step 4: Add keyboard and responsive behavior.**

Verify all controls are keyboard focusable, dialogs close with Escape, tables remain usable at 768px, navigation collapses at 320px, and 1024px/1440px layouts preserve the control plane hierarchy. Add responsive overflow for wide tables rather than hiding important columns.

- [ ] **Step 5: Commit interaction checkpoint.**

```powershell
git add -- 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
git diff --cached --check
git commit -m "feat(skills-ui): add control plane interactions and states"
```

## Task 5: Verify the prototype and protect existing files

**Files:**
- Read-only: `D:/codeproject/JS/bloomai/docs/skills/skill-admin-system-v1.1-design.md`
- Read-only: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-management-console-v1.1.html`
- Verify: `D:/codeproject/JS/bloomai/docs/skills/ui/skill-admin-control-plane-v1.1.html`

- [ ] **Step 1: Run static HTML and design contract checks.**

Run:

```powershell
$h = Get-Content -Raw 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
$required = @('<!doctype html>','Workbench','普通用户','管理员','运维人员','Runtime Overview','Package Catalog','Approval Queue','Capability Policies','Artifact Center','Creator','Legacy Skills','Runtime Diagnostics','Release & Migration','Audit & Evidence','data-theme','aria-modal')
foreach ($marker in $required) { if ($h -notlike "*$marker*") { throw "MISSING_MARKER=$marker" } }
if ($h -match 'skill-management-console-v1.1.html') { throw 'DEPENDENCY_ON_OLD_PROTOTYPE' }
'HTML_CONTRACT=PASS'
```

Expected output: `HTML_CONTRACT=PASS`.

- [ ] **Step 2: Run the browser smoke check.**

Open the file in a Chromium-capable browser and verify:

1. Overview renders without console errors.
2. Role switch changes nav from exactly `普通用户 / 管理员 / 运维人员`.
3. Workbench appears in the context bar.
4. Every page in the sidebar renders a non-empty title.
5. Package, Run, Approval, Artifact, and Migration drawers open and close with Escape.
6. Rollback confirmation contains the forward-fix-only warning.
7. Dark Mode changes surface, text, border, and status tokens.
8. At 768px and 320px the page remains navigable without hidden critical actions.

- [ ] **Step 3: Verify change scope.**

Run:

```powershell
git diff --check
git status --short --branch
git diff --name-only HEAD~4..HEAD -- 'docs/skills/skill-admin-system-v1.1-design.md' 'docs/skills/ui/skill-admin-control-plane-v1.1.html' 'docs/superpowers/specs/2026-08-06-skills-admin-system-design.md'
```

Expected: no whitespace errors; only the new design/spec/prototype files appear in the commits; existing `skill-management-console-v1.1.html` and user files remain unmodified.

- [ ] **Step 4: Commit final verification evidence if the prototype changed.**

```powershell
git add -- 'docs/skills/ui/skill-admin-control-plane-v1.1.html'
git diff --cached --check
git commit -m "docs(skills): finalize v1.1 admin prototype evidence"
```

## Acceptance checkpoints

### Checkpoint A: Shell

- `file://` opens the HTML.
- BloomAI tokens and Workbench context exist.
- Exactly three roles exist.

### Checkpoint B: Pages

- All thirteen page IDs render.
- Package, Run, Approval, Artifact, and Migration detail interactions exist.
- State matrix is represented.

### Checkpoint C: Final

- HTML contract check passes.
- Browser smoke check passes.
- Keyboard and responsive checks pass.
- Existing user files are untouched.
- Only the intended design/spec/prototype files are staged.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| One standalone HTML becomes too large | Medium | Keep data, token, shell, renderer, and interaction sections clearly separated; reuse render helpers. |
| Prototype implies frontend-only security | High | Display disabled actions with server-enforced language and show role filtering as demonstration only. |
| Dense operations UI becomes unreadable | Medium | Use compact tables plus progressive disclosure drawers and status summary cards. |
| Status color fails accessibility | Medium | Always pair color with icon and text, plus focus-visible outlines. |
| Existing user prototype is accidentally changed | High | Never use `git add .`; stage only the new file and verify the old file hash/status. |
