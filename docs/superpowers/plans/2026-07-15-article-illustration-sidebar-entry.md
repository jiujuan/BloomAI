# Article Illustration Sidebar Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Image Studio’s internal mode switch with separate sidebar navigation entries for single-image generation and article illustration.

**Architecture:** Define article illustration as a first-class UI page state. The sidebar owns route selection, `App` selects the matching workbench, and `ImageStudioPage` is reduced to the existing single-image layout. The existing article-illustration store and workbench are reused without changing their backend or generation behavior.

**Tech Stack:** React 18, TypeScript, Zustand, Lucide React, Vitest, Vite.

---

## File structure

- Modify: `src/renderer/store/index.ts` — add the `article-illustration` active page state.
- Modify: `src/renderer/components/layout/NavSidebar.tsx` — expose the main navigation item metadata and place the article illustration icon immediately after AI 画图.
- Create: `src/renderer/components/layout/NavSidebar.test.ts` — verify the sidebar metadata exposes the intended order and labels.
- Modify: `src/renderer/App.tsx` — render single image and article illustration as separate page states.
- Modify: `src/renderer/pages/ImageStudio/index.tsx` — render only the existing single-image workbench and remove the internal tab controls.

### Task 1: Add and verify the navigation contract

**Files:**
- Modify: `src/renderer/components/layout/NavSidebar.tsx`
- Create: `src/renderer/components/layout/NavSidebar.test.ts`

- [ ] **Step 1: Write the failing navigation metadata test**

Create `src/renderer/components/layout/NavSidebar.test.ts`:

```tsx
import { describe, expect, it } from 'vitest'
import { mainNavigationItems } from './NavSidebar'

describe('mainNavigationItems', () => {
  it('places article illustration immediately after AI image generation', () => {
    expect(mainNavigationItems.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'chat', label: 'Chat' },
      { id: 'image', label: 'AI 画图' },
      { id: 'article-illustration', label: '文章配图' },
      { id: 'tools', label: 'Tools' },
      { id: 'skills', label: 'Skills' },
      { id: 'personas', label: 'Personas' },
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run src/renderer/components/layout/NavSidebar.test.ts --pool=forks
```

Expected: FAIL because `mainNavigationItems` and the `article-illustration` entry do not yet exist.

- [ ] **Step 3: Define the navigation metadata and accessible icon button**

In `src/renderer/components/layout/NavSidebar.tsx`:

```tsx
import { BookImage, Image, MessageCircle, Puzzle, Settings, User, Wrench } from 'lucide-react'

export const mainNavigationItems = [
  { id: 'chat' as const, icon: MessageCircle, label: 'Chat' },
  { id: 'image' as const, icon: Image, label: 'AI 画图' },
  { id: 'article-illustration' as const, icon: BookImage, label: '文章配图' },
  { id: 'tools' as const, icon: Wrench, label: 'Tools' },
  { id: 'skills' as const, icon: Puzzle, label: 'Skills' },
  { id: 'personas' as const, icon: User, label: 'Personas' },
]
```

Render `mainNavigationItems` in the existing sidebar loop. Keep each entry as a native `<button>` with `title`, `aria-label`, and `aria-current={activePage === id ? 'page' : undefined}`.

- [ ] **Step 4: Run the navigation test to verify it passes**

Run:

```powershell
npx vitest run src/renderer/components/layout/NavSidebar.test.ts --pool=forks
```

Expected: PASS with one test proving “文章配图” is directly below “AI 画图”.

- [ ] **Step 5: Commit the navigation metadata slice**

```powershell
git add src/renderer/components/layout/NavSidebar.tsx src/renderer/components/layout/NavSidebar.test.ts
git commit -m "feat(nav): add article illustration entry"
```

### Task 2: Route the independent pages

**Files:**
- Modify: `src/renderer/store/index.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/ImageStudio/index.tsx`

- [ ] **Step 1: Extend the UI page type**

In `src/renderer/store/index.ts`, update `UIState`:

```ts
activePage: 'chat' | 'settings' | 'personas' | 'tools' | 'skills' | 'image' | 'article-illustration'
```

Keep `setPage: (page: UIState['activePage']) => void` unchanged so all sidebar IDs remain type-checked.

- [ ] **Step 2: Split top-level page rendering**

In `src/renderer/App.tsx`, import `ArticleIllustrationWorkbench` and add a separate route:

```tsx
{activePage === 'image' && <ImageStudioPage />}
{activePage === 'article-illustration' && <ArticleIllustrationWorkbench />}
```

Do not alter the existing `image` route’s session list, chat panel, or template gallery behavior.

- [ ] **Step 3: Remove the Image Studio internal mode switch**

Replace `src/renderer/pages/ImageStudio/index.tsx` with the single-image-only page:

```tsx
import React, { useEffect } from 'react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ImageSessionList } from './ImageSessionList'
import { ImageChatPanel } from './ImageChatPanel'
import { TemplateGallery } from './TemplateGallery'

export function ImageStudioPage() {
  const loadSessions = useImageStore((store) => store.loadSessions)
  const loadModels = useLlmStore((store) => store.loadModels)

  useEffect(() => {
    void loadSessions()
    void loadModels()
  }, [loadModels, loadSessions])

  return <div className="image-studio">
    <ImageSessionList />
    <ImageChatPanel />
    <TemplateGallery />
  </div>
}
```

This removes the `useState<'single' | 'article'>` mode, the `image-studio-mode` tab list, and the “Single image / Article illustration” buttons.

- [ ] **Step 4: Verify static type safety and the existing article store**

Run:

```powershell
npx vitest run src/renderer/components/layout/NavSidebar.test.ts src/renderer/pages/ImageStudio/article-illustration.store.test.ts --pool=forks
npm run typecheck
```

Expected: both Vitest files pass and TypeScript confirms every navigation ID is valid.

- [ ] **Step 5: Build the renderer and inspect the final diff**

Run:

```powershell
npm run build
git diff --check
```

Expected: both commands exit 0. The existing Vite chunk-size warning may appear but must not fail the build.

- [ ] **Step 6: Commit the routing slice**

```powershell
git add src/renderer/store/index.ts src/renderer/App.tsx src/renderer/pages/ImageStudio/index.tsx
git commit -m "feat(image): split article illustration navigation"
```

## Coverage review

- Dedicated sidebar icon directly below AI 画图: Task 1.
- Meaningful BookImage icon plus native-button accessibility semantics: Task 1.
- Single image route has no internal mode tabs: Task 2.
- Article illustration opens as a separate page without backend or workflow changes: Task 2.
- Type safety, focused tests, production build, and formatting validation: Task 2.