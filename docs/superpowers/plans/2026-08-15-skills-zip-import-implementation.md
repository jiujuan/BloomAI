# Skills ZIP Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `npx skills 产物` import path with a first-class `导入skills zip` Tab that selects a local ZIP file and imports every valid Skill it contains through the existing secure ZIP package flow.

**Architecture:** The Renderer will construct the existing `{ kind: 'zip', zipPath, subdirectory? }` `PackageSource`; the server-side package installer already owns ZIP validation, safe extraction, skill discovery, review, and installation. A narrowly scoped Electron IPC bridge will return one user-selected ZIP file path, with the preload and Renderer platform façade exposing only that constrained operation.

**Tech Stack:** React 18 + TypeScript, Electron IPC, Vitest, existing `PackageInstaller` ZIP source reader.

---

## File structure

- **Modify** `src/shared/constants/ipc.ts` — define the ZIP file dialog IPC channel.
- **Modify** `src/main/ipc/dialogs.ts` — register a ZIP-only native open-file dialog and map a single selected path.
- **Modify** `src/main/ipc/dialogs.test.ts` and `src/main/ipc/dialogs-handler.test.ts` — cover mapping and exact native-dialog options.
- **Modify** `src/main/index.ts` and `src/main/index.test.ts` — register the ZIP dialog handler with Electron.
- **Modify** `src/preload/index.ts`, `src/preload/index.test.ts`, and `src/renderer/types/bloomai.d.ts` — expose and type the safe `selectZipFile()` bridge.
- **Modify** `src/renderer/api/index.ts` and `src/renderer/api/projects.test.ts` — expose the Electron bridge through `platform`, safely canceling outside Electron.
- **Modify** `src/renderer/pages/Skills/PackageInstallDialog.tsx` — replace the npx source UI with a ZIP source UI, native file selection, and ZIP drag/drop validation.
- **Modify** `src/renderer/pages/Skills/PackageInstallDialog.test.tsx` — cover labels, validation, and ZIP source construction.
- **Modify** `src/server/skills/packages/package-installer.test.ts` — add a multi-Skill local ZIP regression that proves the existing backend behavior used by the new UI.

## Task 1: Add the constrained Electron ZIP file-selection bridge

**Files:**
- Modify: `src/shared/constants/ipc.ts`
- Modify: `src/main/ipc/dialogs.ts`
- Modify: `src/main/ipc/dialogs.test.ts`
- Modify: `src/main/ipc/dialogs-handler.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/index.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/renderer/types/bloomai.d.ts`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/api/projects.test.ts`

- [x] **Step 1: Write failing main-process dialog tests.**

Add ZIP-specific test cases next to the directory dialog tests. The handler test must expect the exact narrow Electron options:

```ts
expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.dialogSelectZipFile, expect.any(Function))
const listener = handle.mock.calls[0][1]
await expect(listener()).resolves.toEqual({ canceled: false, path: 'D:\\downloads\\skills.zip' })
expect(showOpenDialog).toHaveBeenCalledWith({
  properties: ['openFile'],
  filters: [{ name: 'ZIP files', extensions: ['zip'] }],
})
```

Add cancellation mapping coverage that asserts `{ canceled: true }` contains no path.

- [x] **Step 2: Run the focused dialog tests to verify they fail.**

Run:

```powershell
npx vitest run src/main/ipc/dialogs.test.ts src/main/ipc/dialogs-handler.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because `dialogSelectZipFile`, `mapZipFileSelection`, and `registerZipFileDialogHandler` do not exist.

- [x] **Step 3: Implement the main-process IPC contract.**

In `src/shared/constants/ipc.ts`, add:

```ts
dialogSelectZipFile: 'dialog:select-zip-file',
```

In `src/main/ipc/dialogs.ts`, keep the existing directory handler unchanged and add separate ZIP option/result types and functions:

```ts
export const ZIP_FILE_DIALOG_OPTIONS = {
  properties: ['openFile'] as ['openFile'],
  filters: [{ name: 'ZIP files', extensions: ['zip'] }],
}

export function mapZipFileSelection(result: DirectoryDialogResult): DirectorySelection {
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
}

export function registerZipFileDialogHandler(ipcMain: IpcMainLike, showOpenDialog: ShowOpenDialog): void {
  ipcMain.handle(IPC_CHANNELS.dialogSelectZipFile, async () => {
    return mapZipFileSelection(await showOpenDialog(ZIP_FILE_DIALOG_OPTIONS))
  })
}
```

Widen `IpcMainLike` and `ShowOpenDialog` only as much as necessary to accept both directory and ZIP dialog option shapes. In `src/main/index.ts`, register it alongside `registerDirectoryDialogHandler`:

```ts
registerZipFileDialogHandler(ipcMain, (options) => dialog.showOpenDialog(options))
```

- [x] **Step 4: Run the focused main-process tests to verify they pass.**

Run:

```powershell
npx vitest run src/main/ipc/dialogs.test.ts src/main/ipc/dialogs-handler.test.ts src/main/index.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS, including both `dialog:select-directory` and `dialog:select-zip-file` registration assertions.

- [x] **Step 5: Write failing preload and Renderer platform tests.**

Extend the preload test to assert `selectZipFile` is exposed and invokes `IPC_CHANNELS.dialogSelectZipFile`. Extend the platform test to assert both conditions:

```ts
await expect(platform.selectZipFile()).resolves.toEqual({ canceled: true })

const selectZipFile = vi.fn().mockResolvedValue({ canceled: false, path: 'D:/downloads/skills.zip' })
vi.stubGlobal('window', { bloomai: { selectZipFile } })
await expect(platform.selectZipFile()).resolves.toEqual({ canceled: false, path: 'D:/downloads/skills.zip' })
expect(selectZipFile).toHaveBeenCalledOnce()
```

- [x] **Step 6: Run the focused preload/platform tests to verify they fail.**

Run:

```powershell
npx vitest run src/preload/index.test.ts src/renderer/api/projects.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because `selectZipFile` is absent from the preload bridge, declaration, and platform API.

- [x] **Step 7: Implement preload, global declaration, and Renderer platform support.**

Add these matching methods:

```ts
// src/preload/index.ts
selectZipFile: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectZipFile),

// src/renderer/types/bloomai.d.ts
selectZipFile(): Promise<{ canceled: boolean; path?: string }>

// src/renderer/api/index.ts
async selectZipFile(): Promise<{ canceled: boolean; path?: string }> {
  if (!isElectron() || !window.bloomai?.selectZipFile) return { canceled: true }
  return window.bloomai.selectZipFile()
},
```

- [x] **Step 8: Run all bridge tests to verify they pass.**

Run:

```powershell
npx vitest run src/main/ipc/dialogs.test.ts src/main/ipc/dialogs-handler.test.ts src/main/index.test.ts src/preload/index.test.ts src/renderer/api/projects.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS.

## Task 2: Replace the npx import tab with a ZIP import tab

**Files:**
- Modify: `src/renderer/pages/Skills/PackageInstallDialog.tsx`
- Modify: `src/renderer/pages/Skills/PackageInstallDialog.test.tsx`

- [x] **Step 1: Write failing import-workflow tests.**

Replace the existing npx expectations with ZIP behavior:

```ts
expect(validatePackageSourceInput('zip', {})).toContain('请选择本地 ZIP 文件。')
expect(validatePackageSourceInput('zip', { zipPath: 'D:/downloads/skills.txt' })).toContain('ZIP 文件必须使用 .zip 扩展名。')
expect(buildPackageSource('zip', { zipPath: 'D:/downloads/skills.zip', subdirectory: 'skills' })).toEqual({
  kind: 'zip',
  zipPath: 'D:/downloads/skills.zip',
  subdirectory: 'skills',
})
```

For page markup, assert exactly three Tabs in this order:

```ts
expect(tabLabels).toEqual(['GitHub Archive', '本地目录', '导入skills zip'])
expect(pageMarkup).toContain('选择 ZIP 文件')
expect(pageMarkup).toContain('ZIP 文件路径')
expect(pageMarkup).toContain('扫描 ZIP 内的 Skills')
expect(pageMarkup).not.toContain('npx skills 产物')
expect(pageMarkup).not.toContain('npx skills add')
```

- [x] **Step 2: Run the focused dialog test to verify it fails.**

Run:

```powershell
npx vitest run src/renderer/pages/Skills/PackageInstallDialog.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because the UI still renders the npx tab and `PackageSourceInput` has no `zipPath` field.

- [x] **Step 3: Implement the ZIP Tab and source construction.**

In `PackageInstallDialog.tsx`:

1. Replace `ImportSourceKind` with:

```ts
export type ImportSourceKind = 'github' | 'local-directory' | 'zip'
```

2. Replace `artifactPath?: string` with `zipPath?: string` in `PackageSourceInput`.
3. Update `SOURCE_LABELS` to map `zip` to `导入skills zip`.
4. Make the third `IMPORT_SOURCE_TABS` entry:

```ts
{ kind: 'zip', label: '导入skills zip', description: '选择 ZIP 压缩包并扫描其中的 Skills' }
```

Use `FileArchive` for the ZIP tab icon and remove `Code2`.
5. Update ZIP validation and source construction:

```ts
if (kind === 'zip' && !trim(input.zipPath)) errors.push('请选择本地 ZIP 文件。')
if (kind === 'zip' && trim(input.zipPath) && !/\.zip$/i.test(trim(input.zipPath))) errors.push('ZIP 文件必须使用 .zip 扩展名。')
// ...
if (kind === 'zip') return withSubdirectory({ kind: 'zip', zipPath: trim(input.zipPath) })
```

6. Add a `chooseZipFile` handler that calls `platform.selectZipFile()` and applies the selected path with `updateInput({ zipPath: selected.path })`; surface the controlled error `无法打开 ZIP 文件选择器。` if the bridge rejects.
7. Add a ZIP drop handler that reads only the first dropped file path; reject absent paths and non-`.zip` paths with `请拖入一个 .zip 文件，或使用“选择 ZIP 文件”按钮。`.
8. Replace the npx form branch with a ZIP drop zone and fields:

```tsx
{sourceKind === 'zip' && <>
  <div className="skills-import-directory-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleZipFileDrop}>
    <span className="skills-import-dropzone-icon"><FileArchive size={18} aria-hidden="true" /></span>
    <strong>拖入 Skills ZIP 文件，或选择 ZIP 文件</strong>
    <p>系统会安全解析压缩包，并扫描其中包含 SKILL.md 的目录。</p>
    <button type="button" className="skills-button secondary" onClick={() => void chooseZipFile()} disabled={busy}>
      <FileArchive size={14} />选择 ZIP 文件
    </button>
    {sourceInput.zipPath && <span className="skills-import-selected-path" title={sourceInput.zipPath}>{sourceInput.zipPath}</span>}
  </div>
  <label className="skills-field"><span>ZIP 文件路径</span><input autoFocus={!sourceInput.zipPath} value={sourceInput.zipPath || ''} onChange={(event) => updateInput({ zipPath: event.target.value })} placeholder="D:/downloads/skills.zip" disabled={busy} /></label>
  <SubdirectoryField value={sourceInput.subdirectory} onChange={(value) => updateInput({ subdirectory: value })} disabled={busy} />
</>}
```

9. Update the page heading to say “把本地目录、GitHub Archive 或 Skills ZIP 转换为可审核的 Skill Version。”

- [x] **Step 4: Run the focused import-workflow tests to verify they pass.**

Run:

```powershell
npx vitest run src/renderer/pages/Skills/PackageInstallDialog.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS; no rendered npx import UI remains.

## Task 3: Prove the reused ZIP backend flow imports multiple Skills

**Files:**
- Modify: `src/server/skills/packages/package-installer.test.ts`

- [x] **Step 1: Write a failing multi-Skill local ZIP regression.**

Add a test that uses the existing `writeStoredZip` helper to create `fixtureDir/multi-skills.zip` with two independent manifests:

```ts
writeStoredZip(zipPath, [
  { name: 'bundle/article/SKILL.md', content: '# Article\n' },
  { name: 'bundle/research/SKILL.md', content: '# Research\n' },
])
```

Then inspect, approve, and install the exact ZIP source:

```ts
const source = { kind: 'zip' as const, zipPath }
const inspected = await installer.inspect(source)
expect(inspected.packages.map((item) => item.relativeSkillPath).sort()).toEqual(['bundle/article', 'bundle/research'])
await approvePackageImportReview(inspected.reviewId)
const result = await installer.install(source, {
  reviewId: inspected.reviewId,
  sourceFingerprint: inspected.sourceFingerprint,
  confirm: true,
})
expect(result.packages).toHaveLength(2)
```

- [x] **Step 2: Run the focused backend test to verify it fails or exposes a missing assertion.**

Run:

```powershell
npx vitest run src/server/skills/packages/package-installer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: the new test initially fails if its expected source paths do not match the actual ZIP reader output; adjust only the expected relative paths after confirming the existing reader’s documented behavior, not the production security implementation.

- [x] **Step 3: Make only the minimum test-fixture correction required for the existing backend contract.**

Do not loosen ZIP validation, budget limits, source fingerprinting, or review gates. If the result uses a repository-root-normalized relative path, update the test assertion to that exact existing contract; production backend code should remain unchanged unless the test demonstrates a real failure to discover a valid nested `SKILL.md`.

- [x] **Step 4: Run the backend ZIP regression to verify it passes.**

Run:

```powershell
npx vitest run src/server/skills/packages/package-installer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

Expected: PASS, including existing security rejection, fingerprint-change, and ZIP budget tests.

## Task 4: Full verification and commit

**Files:**
- Verify all files listed above.

- [x] **Step 1: Run TypeScript validation.**

Run:

```powershell
npm run typecheck:skills
```

Expected: exit code 0.

- [x] **Step 2: Run the skills unit suite.**

Run:

```powershell
npm run test:skills:unit
```

Expected: all tests pass.

- [x] **Step 3: Run style and repository checks.**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the ZIP import implementation, tests, and this plan are modified or untracked.

- [ ] **Step 4: Commit the implementation after user verification request.**

Stage only the files changed for the ZIP import feature and commit with:

```powershell
git commit -m "feat(skills): import skills from ZIP files"
```

Expected: a clean working tree apart from any user-owned unrelated files. Do not push unless explicitly requested.
