# BloomAI Windows 图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 BloomAI 生成可识别的多尺寸 Windows 图标，并接入 Electron 主窗口、托盘和 electron-builder。

**Architecture:** 使用 `public/icons` 作为 Vite 静态资源目录，SVG 作为品牌源文件，使用仓库现有 Python Pillow 生成 256 px PNG 与多尺寸 ICO。主进程通过 `app.getAppPath()` 按开发/生产环境解析图标路径，打包配置通过 `build.win.icon` 指向同一 ICO。

**Tech Stack:** Electron 37、Vite 5、electron-builder 24、TypeScript、SVG、Python Pillow 12.2.0。

---

### Task 1: Create reproducible Bloom Orb icon assets

**Files:**
- Create: `D:\codeproject\JS\bloomai\public\icons\bloomai-icon.svg`
- Create: `D:\codeproject\JS\bloomai\public\icons\bloomai-icon.png`
- Create: `D:\codeproject\JS\bloomai\public\icons\bloomai.ico`
- Create: `D:\codeproject\JS\bloomai\scripts\generate-bloomai-icon.py`

- [ ] **Step 1: Write the SVG source**
  Use a 256×256 viewBox with a rounded navy square, a cyan/blue/purple orb, a white bloom-shaped highlight, and a small white sparkle. Keep the artwork inside 8 px of the canvas and do not add text.

- [ ] **Step 2: Write the Pillow generator**
  Implement a Python script with `PIL.Image`, `ImageDraw`, and `ImageFilter` that draws the same geometry at 1024 px, downsizes with `Image.Resampling.LANCZOS`, saves `bloomai-icon.png` at 256 px, and saves `bloomai.ico` with sizes `(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)`. Use RGBA and verify alpha is preserved.

- [ ] **Step 3: Generate and inspect asset metadata**
  Run `python scripts/generate-bloomai-icon.py` from `D:\codeproject\JS\bloomai`. Confirm the three files exist, PNG dimensions are 256×256, and the ICO contains all seven requested sizes.

- [ ] **Step 4: Commit the assets**
  Stage only the four new icon files and commit with `git commit -m "feat: add BloomAI Windows icon assets"`.

### Task 2: Connect the icon to Electron

**Files:**
- Modify: `D:\codeproject\JS\bloomai\src\main\index.ts` near the `isDev` declaration, `createMainWindow`, and `createTray`.

- [ ] **Step 1: Add a single icon path resolver**
  Define `getAppIconPath()` that returns `public/icons/bloomai.ico` when `!app.isPackaged`, returns `dist/icons/bloomai.ico` when packaged, and returns `undefined` if the selected path does not exist.

- [ ] **Step 2: Set the main window icon**
  Add `icon: getAppIconPath()` to the `BrowserWindow` options in `createMainWindow()`. Do not alter window dimensions or unrelated webPreferences.

- [ ] **Step 3: Replace the empty tray image**
  In `createTray()`, load the resolved ICO with `nativeImage.createFromPath()`, resize it to 16×16 for the Windows notification area, and fall back to `nativeImage.createEmpty()` only if the file is unavailable.

- [ ] **Step 4: Add a Windows builder icon**
  Add a `win` object under `build` in `D:\codeproject\JS\bloomai\package.json` with `icon: "public/icons/bloomai.ico"`; preserve every existing build key and existing unrelated package changes.

- [ ] **Step 5: Run typecheck**
  Run `npm run typecheck`. Expected: exit code 0 with no new TypeScript errors.

- [ ] **Step 6: Commit Electron integration**
  Stage only `src/main/index.ts` and `package.json`, then commit with `git commit -m "fix: wire BloomAI icon into Electron"`.

### Task 3: Build and verify packaging output

**Files:**
- Verify: `D:\codeproject\JS\bloomai\dist\icons\bloomai.ico`
- Verify: `D:\codeproject\JS\bloomai\dist-electron\main.js`

- [ ] **Step 1: Run the production build**
  Run `npm run build`. Expected: TypeScript and Vite complete successfully.

- [ ] **Step 2: Verify the copied icon**
  Confirm `dist/icons/bloomai.ico` exists and has the same byte length as `public/icons/bloomai.ico`; inspect the built HTML/assets list to ensure Vite copied the public resource.

- [ ] **Step 3: Verify the main-process bundle**
  Search `dist-electron/main.js` for the icon path fragments `public/icons/bloomai.ico`, `dist/icons/bloomai.ico`, and `createFromPath`.

- [ ] **Step 4: Run the focused test suite**
  Run `npm test`. Expected: existing tests pass; if unrelated pre-existing failures occur, report them separately without modifying unrelated files.

- [ ] **Step 5: Record final status**
  Use `git status --short` to confirm only intended icon files, integration changes, generated build output, and the already-present unrelated user changes remain.
