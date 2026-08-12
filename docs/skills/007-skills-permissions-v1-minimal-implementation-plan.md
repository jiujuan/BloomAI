# Skills 后台权限系统 v1（最小可用版）实施计划

> **文档编号：** 007-skills-permissions-v1-minimal-implementation-plan  
> **版本：** v1.0  
> **状态：** Ready for implementation  
> **编写日期：** 2026-08-12  
> **适用项目：** `D:\codeproject\JS\bloomai`  
> **前置方案：** 暂时下线 Skills 后台“权限与安装”管理页面，保留运行时审批和服务端安全链路。  
> **执行方式：** 每个 Task 只实现一个可验收功能；完成一个 Task 后运行该 Task 的测试和验收命令，再进入下一 Task。

---

## 0. 文档目的与执行规则

### 0.1 目标

本计划用于把当前 Skills 后台从“Package Grant 管理页面 + Run 审批”收敛为第一版最简单可用的权限系统：

- 用户不再从 Skills 左侧导航、Workbench Detail 或 Package Detail Drawer 进入 Package Capability Grant 管理页面。
- 运行过程中遇到需要人工授权的 Capability 时，Run 进入 `waiting_approval`，用户在 **Run Detail** 完成批准、拒绝或取消。
- Import Review、Installation 生命周期和底层 Capability/Policy/Broker/Grant API 继续保留。
- 旧权限页面链接可安全降级到 Skill Detail，不产生白屏、未知视图或失效跳转。
- 本版本只修改 Renderer 用户界面和其测试；不借页面隐藏之名删除或放宽服务端授权。

### 0.2 执行规则

1. **先测试后改代码。** 每个 Task 先补一个会失败的最小测试或静态契约断言，再修改生产代码。
2. **一 Task 一功能。** 不把导航下线、详情抽离、Pending Approval 跳转和服务端保留混成一个不可回滚的大改动。
3. **不覆盖已有工作区改动。** 开始实现前必须确认 `git status --short`；只编辑本计划明确列出的代码行，不能 reset、restore 或整文件覆盖用户已有修改。
4. **兼容优先。** 旧 hash `#skills/tab=permissions&package=pkg-1` 必须解析为 `detail + selectedPackageId=pkg-1`。
5. **证据优先。** 每个 Task 的完成必须记录修改文件、测试输出、验收命令和未解决风险。

### 0.3 状态标记

- `- [ ]`：未完成；`- [x]`：完成。
- `DOING`、`REVIEW`、`DONE` 只写入实际执行记录，不预先宣称完成。
- 本文中的命令和代码片段是实施基线；若源码在执行前已发生变化，必须先重新定位符号并更新计划记录。

---

## 1. 第一版范围冻结

### 1.1 本次下线的 UI 功能

| 功能 | 下线点 | v1 结果 |
|---|---|---|
| 左侧权限导航 | `SkillsSidebar.tsx` 的 `permissions` nav item | 不显示“权限与安装”，公开导航从 9 项变为 8 项 |
| 权限公开路由 | `SkillsCenterWorkbench.tsx` 的 `permissions` tab 分支 | 不再作为公开视图；旧链接降级到 `detail` |
| Workbench Grant 管理 | Detail 页挂载 `SkillCapabilityPanel` 并传入批准/拒绝 handler | 不再显示 Package Grant 管理面板 |
| Drawer Grant 管理 | `PackageDetailDrawer.tsx` 的 Grant 列表/批准/拒绝/撤销 | 不再显示 Package Grant 操作 |
| Catalog 跳转 | Pending Approval 行打开权限页 | 直接打开对应 Run Detail |

### 1.2 第一版保留的能力

- Run Detail 的 `waiting_approval`、批准、拒绝、取消。
- `CapabilityApprovalCard` 与 `RunActionPanel`。
- Import Review approve/reject。
- Installation 启用、禁用、回滚、卸载。
- Renderer API 和 Store 中的 Capability Grant 方法。
- Server Policy、Capability Broker、Grant Service、Grant routes、数据库表和 migration。
- `SkillCapabilityPanel.tsx`、`SkillPermissionsPanel.tsx`、`SkillInstallationPanel.tsx` 及其独立纯组件测试；它们暂不从仓库删除，避免破坏底层契约和后续恢复入口。

### 1.3 明确非目标

- 不新增 RBAC、用户角色、权限组、角色表、组织级授权或数据库 migration。
- 不把 UI 隐藏误认为授权：服务端仍必须校验 actor、scope、状态、安装状态和 Capability Policy。
- 不删除 `/skill-capability-grants/:id/approve`、`/reject`、`/revoke` 路由。
- 不将所有 Capability 自动批准；未批准的运行仍必须停在 `waiting_approval`。
- 不在本 Task 计划中重做 Run 状态机、Worker、Capability Broker 或 Grant Service。

### 1.4 用户路径（v1）

```text
Run 启动
  -> Capability Broker 发现需要人工授权
  -> Run status = waiting_approval
  -> Skills Center / Runs 列表出现 Pending Approval
  -> 用户点击该 Run
  -> Run Detail: CapabilityApprovalCard
       -> 批准：继续运行
       -> 拒绝：Run 进入拒绝/失败结果
       -> 取消：取消本次 Run
```

---

## 2. 影响面总览

### 2.1 需要修改的生产文件

1. `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsSidebar.tsx`：移除公开 `permissions` 导航及其 breadcrumb 分支。
2. `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx`：兼容旧 hash、删除 Workbench Grant 管理状态/handler/挂载。
3. `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\PackageDetailDrawer.tsx`：移除 Drawer Grant 管理状态、事件和 JSX，保留安装与 Manifest/版本/Run。
4. `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillOverviewPanel.tsx`：Pending Approval 行直接进入 Run Detail，并删除 `onOpenGrant` prop。

### 2.2 需要修改或新增断言的测试文件

- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills-navigation-shell.test.tsx`：9 项改为 8 项，断言权限导航不存在。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.test.tsx`：旧 `permissions` hash 降级为 `detail`。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills-center.e2e.ts`：旧 hash 在浏览器中不落到死路，且仍打开 Package Detail。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterCatalogActions.test.tsx`：移除 `onOpenGrant` 参数并保持 Catalog 行为。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterCatalog.test.tsx`：移除过时 prop；保留 Pending Approval 展示契约。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillDetailWorkflow.test.tsx`：保留底层 Capability 纯组件测试；可增加 Drawer 静态契约断言。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillPermissionsWorkflow.test.tsx`：保留 Capability/Installation/Runtime 组件契约，不把内部组件测试当作公开导航测试。
- `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\run-detail.test.tsx`：确认 `waiting_approval`、批准、拒绝、取消不被本次 UI 收敛误删。

### 2.3 只读安全链路文件（不改代码，只扫描并测试）

以下文件是 v1 权限闭环的安全底座；页面下线后仍要扫描确认，不应删除或修改：

```text
D:\codeproject\JS\bloomai\src\renderer\api\index.ts
D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skill-runtime.store.ts
D:\codeproject\JS\bloomai\src\server\http\skills-policy.ts
D:\codeproject\JS\bloomai\src\server\http\routes\skill-package-runtime.ts
D:\codeproject\JS\bloomai\src\server\skills\application\capability-grant.service.ts
D:\codeproject\JS\bloomai\src\server\skills\policy\capability-policy.ts
D:\codeproject\JS\bloomai\src\server\skills\policy\capability-broker.ts
```

---

## 3. 实施前基线与工作区保护

### Task 0 — 冻结现状、记录基线并建立失败测试

- [x] **功能目标：** 在任何业务代码修改前，固定当前工作区状态、目标符号和旧链接兼容契约。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\docs\skills\007-skills-permissions-v1-minimal-implementation-plan.md`（本计划）。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills-navigation-shell.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.test.tsx`。
- [x] **代码位置与修改：**
  1. 记录 `git status --short`，把已有改动标记为“非本 Task 所有”：`SkillOverviewPanel.tsx`、`SkillsCenterCatalog.test.tsx`、`SkillsCenterWorkbench.tsx`、`SkillsVisualResponsiveA11yWorkflow.test.tsx`、`global.css`、`.agents/`。
  2. 在导航测试中先把公开视图期望从 9 项调整为 8 项，并加入“不包含 `permissions`/`权限与安装`”的失败断言。
  3. 在 Workbench 测试中先增加旧 hash `#skills/tab=permissions&package=pkg-1` 应解析到 `detail` 的失败断言；测试必须调用真实导出的 decoder 或通过组件可观测路由状态验证，禁止只测试复制的伪函数。
- [x] **建议测试片段：**
```tsx
expect(SKILLS_RUNTIME_NAV_ITEMS.map((item) => item.id)).toEqual(['center', 'import', 'creator', 'detail', 'runs', 'run-detail', 'artifacts', 'settings'])
expect(SKILLS_RUNTIME_NAV_ITEMS.some((item) => item.id === 'permissions')).toBe(false)
```
- [x] **命令：**
```powershell
git -C D:\codeproject\JS\bloomai status --short
npm run typecheck --if-present
npx vitest run src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx
```
- [x] **预期结果：** 基线状态可追溯；新增断言在生产代码尚未修改时失败，证明测试确实锁定了目标行为；不得修改或清理工作区已有文件。
- [x] **验收标准：** 已保存基线输出；测试失败原因直接指向权限导航仍公开或旧 hash 尚未降级，而不是 import、环境或无关测试错误。
- [x] **Dependencies：** 无。
- [x] **Estimated scope：** 0.5 天；只改测试和计划记录，不改业务实现。
#### Task 0 执行记录（2026-08-12）

- **状态：** DONE（仅完成基线冻结与失败测试；未修改业务代码）。
- **执行前工作区基线：** `git status --short` 输出为：
  - `?? .agents/`
  - `?? docs/skills/007-skills-permissions-v1-minimal-implementation-plan.md`
- **非本 Task 所有的已有工作区内容：** `.agents/` 目录及本计划文件作为执行前未跟踪内容保留；执行前 `git diff --stat` 为空。未发现并覆盖 `SkillOverviewPanel.tsx`、`SkillsCenterCatalog.test.tsx`、`SkillsCenterWorkbench.tsx`、`SkillsVisualResponsiveA11yWorkflow.test.tsx`、`global.css` 等已有业务改动；本 Task 只修改下方两个测试文件。
- **新增测试：**
  - `skills-navigation-shell.test.tsx`：公开导航从 9 项改为 8 项，并断言不包含 `permissions` 和“权限与安装”。
  - `SkillsCenterWorkbench.test.tsx`：调用真实导出的 `decodeSkillsCenterState`，断言 `#skills/tab=permissions&package=pkg-1` 归一化为 `detail` 并保留 `selectedPackageId`。
- **基线命令结果：**
  - `npm run typecheck --if-present`：通过（`tsc --noEmit`，2026-08-12；首次 120 秒执行超时无诊断，随后以 300 秒上限重跑通过）。
  - 变更测试前的目标 Vitest：2 个文件、8 个测试全部通过。
  - 加入失败断言后的目标 Vitest：按预期失败，2 个文件、3 个失败、5 个通过；失败直接指向：
    1. 仍收到 `permissions` 导航项；
    2. 渲染结果仍包含“权限与安装”；
    3. 真实 decoder 仍返回 `{ tab: 'permissions', selectedPackageId: 'pkg-1' }`。
- **未解决风险：** 生产实现尚未修改，因此上述 3 个失败是预期的红灯；后续 Task 1/2 必须分别修复导航公开入口和旧 hash 归一化。未执行任何 reset、restore、清理或后端权限改动。
- **变更范围核对：** 当前工作区只新增两个已跟踪测试文件的修改；未新增 RBAC、角色表、migration、自动批准逻辑或服务端授权变更。

### Task 1 — 下线左侧权限导航并收敛公开视图类型

- [x] **功能目标：** 用户无法从 Skills Sidebar 进入“权限与安装”；公开导航只保留 8 个视图。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsSidebar.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills-navigation-shell.test.tsx`。
- [x] **精确修改点：**
  1. 删除 `LockKeyhole` import。
  2. 将 `SkillsRuntimeView` 从 `... | 'detail' | 'permissions' | 'runs' ...` 改为 `... | 'detail' | 'runs' ...`。
  3. 删除 `permissions` 导航项：
```tsx
{ id: 'permissions', label: '权限与安装', icon: LockKeyhole, group: 'workspace' },
```
  4. 将 breadcrumb 条件从 `view === 'detail' || view === 'permissions' || view === 'artifacts'` 改为 `view === 'detail' || view === 'artifacts'`。
- [x] **测试：**
  - 公开导航数组长度为 8。
  - 不存在 id 为 `permissions` 的 item。
  - “权限与安装”不出现在导航渲染结果。
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/skills-navigation-shell.test.tsx
```
- [x] **预期结果：** 导航测试通过，8 项导航均可渲染和切换；权限页面没有公开入口。
- [x] **验收标准：** `rg -n "LockKeyhole|id: 'permissions'|view === 'permissions'" src/renderer/pages/Skills/SkillsSidebar.tsx` 无匹配；导航测试通过。
- [x] **Dependencies：** Task 0。
- [x] **Estimated scope：** 0.25 天；约 4 个生产代码改动点和对应测试。
#### Task 1 执行记录（2026-08-12）

- **状态：** DONE（仅下线左侧公开权限导航；Workbench 兼容解析及 Grant 管理留待后续 Task）。
- **生产修改：** `src/renderer/pages/Skills/SkillsSidebar.tsx`
  - 删除 `LockKeyhole` import。
  - 从 `SkillsRuntimeView` 删除 `permissions`。
  - 删除 `permissions` 导航项。
  - 删除 breadcrumb 对 `permissions` 的分支。
- **测试修改：** `src/renderer/pages/Skills/skills-navigation-shell.test.tsx`
  - 公开导航期望为 8 项。
  - 断言不存在 `permissions` item，并且渲染结果不包含“权限与安装”。
  - 使用 `(item.id as string)` 保留运行时 legacy 字符串契约断言，同时避免已收敛 union 触发 TypeScript 无交集比较错误。
- **验证：**
  - `npx vitest run src/renderer/pages/Skills/skills-navigation-shell.test.tsx`：通过，1 个文件、3 个测试全部通过。
  - `rg -n "LockKeyhole|id: 'permissions'|view === 'permissions'" src/renderer/pages/Skills/SkillsSidebar.tsx`：无匹配。
  - `git diff --check`：通过。
- **后续已识别的依赖错误：** Task 1 收窄共享 `SkillsRuntimeView` 后，`npm run typecheck --if-present` 暴露了 Task 2/3 范围内的 Workbench 旧 `permissions` 兼容分支（`openGrantContext`、Detail JSX 等）以及 Task 1 测试中的无交集比较；测试比较已在本 Task 修正。Workbench 生产兼容分支不在 Task 1 的允许文件范围内，留待 Task 2/3 按计划处理，未在本 Task 越界修改。
- **范围核对：** 未修改后端、数据库、Grant 服务或其他 UI 文件；保留 Task 0 的既有测试改动和工作区未跟踪内容。

### Task 2 — 旧权限 hash 降级到 Skill Detail

- [x] **功能目标：** 兼容旧书签、通知和历史链接；旧 `permissions` 路由不再进入已下线页面，而是打开对应 Package Detail。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skills-center.e2e.ts`。
- [x] **精确修改点：**
  1. 保留 hash 解析对 `tab=permissions` 的识别，但在 `decodeSkillsCenterState` 内立即归一化：
```ts
const rawTab = params.get('tab') as SkillsCenterTab | null
const tab = rawTab === 'permissions' ? 'detail' : rawTab || 'center'
return { tab, selectedPackageId: params.get('package') || undefined, selectedRunId: params.get('run') || undefined, draftId: params.get('draft') || undefined }
```
  2. 由于公开 `SkillsCenterTab` 不再包含 `permissions`，解析层使用受控 legacy union/type guard，不能用 `as SkillsCenterTab` 把未知值扩散到生产路由。
  3. `selectTab` 的判断从允许 `permissions` 改为只允许 `nextView === 'detail'`。
  4. 旧链接带 `package` 时保留 `selectedPackageId`，使 Drawer/Detail 上下文不丢失。
- [x] **建议测试片段：**
```tsx
expect(decodeSkillsCenterState('#skills/tab=permissions&package=pkg-1')).toMatchObject({ tab: 'detail', selectedPackageId: 'pkg-1' })
```
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx
npx playwright test src/renderer/pages/Skills/skills-center.e2e.ts --grep "legacy permissions hash"
```
- [x] **预期结果：** 旧 hash 只落到 Skill Detail；不显示空权限页，不抛未知 tab 错误，Package Detail 仍可打开。
- [x] **验收标准：** 单测和 E2E 均能证明 `permissions -> detail`，且 `package` 参数被保留；新链接不会生成 `tab=permissions`。
- [x] **Dependencies：** Task 1。
- [x] **Estimated scope：** 0.5 天；解析器、选择器和兼容测试。

#### Task 2 执行记录（2026-08-12）

- **状态：** DONE（旧 permissions hash 已归一化到 detail；未处理 Task 3 的 Grant UI 删除）。
- **生产修改：** src/renderer/pages/Skills/SkillsCenterWorkbench.tsx
  - 增加受控 LegacySkillsCenterTab 与 isSkillsCenterTab type guard；未知 tab 不扩散到公开 SkillsCenterTab。
  - decodeSkillsCenterState 将 rawTab === 'permissions' 立即映射为 detail，并保留 package、run、draft 参数。
  - selectTab 仅在 nextView === 'detail' 时保留 selectedPackageId。
  - 旧权限上下文入口改为 tab: 'detail'；Detail 渲染条件不再包含 permissions。
- **测试修改：**
  - SkillsCenterWorkbench.test.tsx 继续调用真实 decoder，断言旧 hash 归一化为 detail 且保留 pkg-1。
  - skills-center.e2e.ts 新增 legacy permissions hash 契约：重新编码为 #skills/tab=detail&package=pkg-1，且不再生成 tab=permissions。
- **验证：**
  - npx vitest run src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx：通过，1 个文件、6 个测试全部通过。
  - npx vitest run src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx：通过，2 个文件、9 个测试全部通过。
  - npm run typecheck --if-present：通过（tsc --noEmit）。
  - rg 静态检查：未发现 tab === 'permissions'、tab: 'permissions'、['detail', 'permissions'] 或无控制的 as SkillsCenterTab；仅保留 legacy decoder/type guard 和契约测试中的 permissions 字符串。
  - git diff --check：通过。
- **范围核对：** 未修改后端、数据库、Policy/Broker/Grant Service/API；未新增 RBAC、角色表、migration 或自动批准逻辑；未删除 SkillCapabilityPanel，留待 Task 3。

### Checkpoint A — 导航和兼容路由

- [x] `permissions` 不在公开导航和公开视图类型中。
- [x] 旧 hash 可打开 Skill Detail，包选择上下文不丢失。
- [x] `skills-navigation-shell`、Workbench 单测和 legacy E2E 通过。
- [x] `git diff -- src/renderer/pages/Skills/SkillsSidebar.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.tsx` 只包含本 Checkpoint 的目标变更和已有用户改动说明。

---

## 4. 下线 Workbench 与 Package Drawer 的 Grant 管理

### Task 3 — 移除 Workbench Detail 的 Package Grant 管理面板

- [x] **功能目标：** Skill Detail 在 Workbench 中只展示版本/Manifest 相关内容，不再展示 Package Capability Grant 审批和拒绝按钮。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterWorkbench.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillDetailWorkflow.test.tsx`。
- [x] **精确修改点：**
  1. 删除 `SkillCapabilityPanel` import。
  2. 删除 `openGrantContext`、`selectedVersionGrants`、`approveGrant`、`rejectGrant` 及其相关 `useMemo`/store 调用。
  3. `counts` 中删除 `permissions` 计数；Pending Approval 计数仍保留在 Runs 或 Catalog 数据中。
  4. `SkillOverviewPanel` 调用删除 `onOpenGrant={openGrantContext}`。
  5. 将生产 Detail JSX 从：
```tsx
(tab === 'detail' || tab === 'permissions') && selectedPackage && <div className="skills-center-detail-grid"><SkillVersionPanel ... /><SkillCapabilityPanel ... /></div>
```
改为只在 `tab === 'detail'` 时渲染 `SkillVersionPanel`：
```tsx
{tab === 'detail' && selectedPackage && <div className="skills-center-detail-grid"><SkillVersionPanel versions={selectedPackage.versions} currentVersionId={selectedPackage.installations[0]?.currentVersionId || selectedPackage.installations[0]?.current_version_id} selectedVersionId={selectedVersion?.id} onSelect={runtime.selectVersion} onPreviewUpdate={createVersionFromVersion} /></div>}
```
  6. 不删除 `PackageManifest` import；当前版本创建逻辑仍使用它。
- [x] **测试：**
  - Workbench Detail 能渲染 Skill Version panel。
  - Workbench 源码不再 import 或挂载 `SkillCapabilityPanel`。
  - `SkillCapabilityPanel` 自身的纯组件契约测试继续通过。
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx
```
- [x] **预期结果：** Detail 页面仍可看版本和创建新版本；Package Grant 管理 UI 不再出现；底层独立 Capability 组件测试不受影响。
- [x] **验收标准：** `rg -n "SkillCapabilityPanel|openGrantContext|selectedVersionGrants|approveGrant|rejectGrant|permissions" SkillsCenterWorkbench.tsx` 只允许兼容解析相关的 legacy 字符串，不允许生产挂载或 handler。
- [x] **Dependencies：** Checkpoint A。
- [x] **Estimated scope：** 0.5 天；删除 Workbench Grant 管理引用并校正类型。


#### Task 3 执行记录（2026-08-12）

- **状态：** DONE（Workbench Detail 已收敛为版本内容展示；Package Grant 管理面板和 Workbench Grant 操作已移除）。
- **生产修改：** `src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`
  - 删除 `SkillCapabilityPanel` import、Workbench Grant context、版本 Grant 派生和 approve/reject handler。
  - 删除 `counts.permissions`，保留 Center/Import/Detail/Runs/Artifacts/Settings 等公开视图计数。
  - `SkillOverviewPanel` 调用不再传入 `onOpenGrant`。
  - Detail 视图只挂载 `SkillVersionPanel`；`PackageManifest` import/创建版本逻辑继续保留。
- **测试修改：** `src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx`
  - 增加 Workbench 静态契约，断言 Detail 保留 `SkillVersionPanel`，且不再 import/挂载 `SkillCapabilityPanel` 或绑定 Grant handler。
  - 保留 `SkillCapabilityPanel` 纯组件生命周期契约测试。
- **TDD 验证：** 新契约先在旧生产代码上失败（7 tests，1 failed；命中 Workbench 的 `SkillCapabilityPanel` import），修改后转绿。
- **验证：**
  - 目标 Vitest 等价直接入口 `node node_modules/vitest/vitest.mjs run src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx`：通过，3 个文件、18 个测试全部通过。
  - `node node_modules/typescript/bin/tsc --noEmit`（等价于 `npm run typecheck --if-present`）：通过。
  - `git diff --check`：通过。
  - `rg -n "SkillCapabilityPanel|openGrantContext|selectedVersionGrants|approveGrant|rejectGrant|permissions" src/renderer/pages/Skills/SkillsCenterWorkbench.tsx`：Workbench 仅保留 legacy decoder/type guard 的两处 `permissions`，未发现 Grant 面板、派生或 handler。
- **范围核对：** 未删除 `SkillCapabilityPanel.tsx`、`SkillPermissionsWorkflow.test.tsx` 或底层 Capability/Grant Store API；未修改后端、数据库、Policy/Broker/Grant Service/API；未新增 RBAC、角色表、migration 或自动批准逻辑。

### Task 4 — 移除 Package Detail Drawer 的 Grant 操作
- [x] **功能目标：** Package Detail Drawer 不再提供 Grant 批准、拒绝、撤销；保留安装生命周期、版本、Manifest、Runs、History 和归档。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\PackageDetailDrawer.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillDetailWorkflow.test.tsx`。
- [x] **精确修改点：**
  1. 删除 `CapabilityGrant` 类型 import 和 `SkillCapabilityPanel` import。
  2. Store 解构删除 `approve`、`reject`、`revokeCapabilityGrant`。
  3. 删除 `selectedGrants` 计算。
  4. 删除 `approveGrant`、`rejectGrant`、`revoke` handlers，以及 Grant 面板 JSX。
  5. 保留 `selectedIsCurrent`：它仍用于阻止历史版本启动新的 Run。
  6. 保留 `manifest`：详情头部和 Manifest 区块仍使用。
- [x] **建议静态契约断言：**
```ts
const source = readFileSync(new URL('./PackageDetailDrawer.tsx', import.meta.url), 'utf8')
expect(source).not.toContain('SkillCapabilityPanel')
expect(source).not.toContain('approveGrant')
expect(source).not.toContain('revokeCapabilityGrant')
```
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx
```
- [x] **预期结果：** Drawer 的安装启用/禁用、回滚、卸载、Run 入口和 Manifest 不受影响；Grant 操作不可见且不再绑定事件。
- [x] **验收标准：** Drawer 中无 Grant action 文案/按钮和 Grant panel 挂载；安装与 Run 相关测试通过；底层权限组件文件仍存在。
- [x] **Dependencies：** Task 3。
- [x] **Estimated scope：** 0.5 天；删除 Grant 相关 UI 状态和操作。

### Checkpoint B — 详情页安全收敛

- [x] Workbench Detail 和 Package Detail Drawer 均无 Package Grant 管理 UI。
- [x] Installation、Version、Manifest、Run、History 和归档入口继续可用。
- [x] `SkillCapabilityPanel`、`SkillPermissionsPanel`、`SkillInstallationPanel` 未被删除。
- [x] 组件/工作流测试通过。

---

## 5. 把待审批入口统一到 Run Detail

### Task 5 — Catalog Pending Approval 直接打开 Run Detail

- [x] **功能目标：** Catalog 中处于 `waiting_approval` 的 Pending Approval 行，点击后直接打开对应 Run Detail，不再跳到权限管理页。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillOverviewPanel.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterCatalogActions.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillsCenterCatalog.test.tsx`。
- [x] **精确修改点：**
  1. `SkillsCenterCatalogProps` 删除 `onOpenGrant`。
  2. `SkillOverviewPanelProps` 删除可选 `onOpenGrant`。
  3. 删除默认空函数和 props 透传。
  4. Pending 行从：
```tsx
onClick={() => onOpenGrant(run.id)}
```
改为：
```tsx
onClick={() => onOpenRun(run.id)}
```
  5. Catalog 测试删除过时 `onOpenGrant={() => undefined}` 传参，但保留 `waiting_approval` 行展示测试。
- [x] **测试策略：**
  - 纯渲染测试验证 Pending Approval 文案、`waiting_approval` 状态和对应 Run id 存在。
  - 若当前测试工具无法在 SSR markup 上触发 React click，不写无法真实触发的伪点击测试；采用源码静态扫描 + Workbench/E2E 的真实点击验证。
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/SkillsCenterCatalogActions.test.tsx src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx
```
- [x] **预期结果：** Pending 行继续显示，但唯一人工审批入口变为 Run Detail；不再调用 `openGrantContext`。
- [x] **验收标准：** `SkillOverviewPanel.tsx` 不再出现 `onOpenGrant`；Pending 行的 handler 明确调用 `onOpenRun(run.id)`；Catalog 测试通过。
- [x] **Dependencies：** Checkpoint B。
- [x] **Estimated scope：** 0.5 天；Props 收敛、handler 替换和测试修正。

### Task 6 — 保证 Run Detail 审批闭环不受影响

- [x] **功能目标：** 证明第一版唯一人工审批入口仍完整：等待审批可见，批准/拒绝/取消动作存在且状态契约未被误删。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\run-detail.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\RunDetailDrawer.tsx`（只读核对；若测试暴露真实回归，才做最小修复）。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skill-runtime.store.ts`（只读核对）。
- [x] **精确核对：**
  1. `waiting_approval` Run 能渲染 CapabilityApprovalCard。
  2. Approve handler 仍调用运行时审批 API/Store，而非已删除的 Package Grant 页面 handler。
  3. Reject handler 仍能提交 reason。
  4. Cancel action 仍可见且不与 Reject 混淆。
  5. Run Detail 不依赖 `permissions` 导航项。
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/run-detail.test.tsx
npx vitest run src/renderer/pages/Skills/SkillsCenterCatalogActions.test.tsx src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx src/renderer/pages/Skills/run-detail.test.tsx
```
- [x] **预期结果：** Run Detail 审批测试全部通过；批准/拒绝/取消仍是唯一用户操作入口。
- [x] **验收标准：** 测试覆盖 `waiting_approval`、approve、reject、cancel；生产代码中没有把 Run approval 改成自动批准或 Package Grant 管理调用。
- [x] **Dependencies：** Task 5。
- [x] **Estimated scope：** 0.25 天；原则上只补测试，不改生产代码。

### Checkpoint C — 最小可用审批路径

- [x] Pending Approval 从 Catalog 直达 Run Detail。
- [x] Run Detail 的批准、拒绝、取消测试通过。
- [x] 页面不再存在第二套 Package Grant 人工审批入口。

---

## 6. 保留服务端安全链路并做回归扫描

### Task 7 — 静态确认 API、Store、Policy、Broker、Grant routes 未被删除

- [x] **功能目标：** 页面下线后，运行时仍能通过服务端安全链路处理 Capability 请求和审批；本 Task 不新增功能，只验证不能误删。
- [x] **Files（只读扫描）：**
  - `D:\codeproject\JS\bloomai\src\renderer\api\index.ts`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\skill-runtime.store.ts`。
  - `D:\codeproject\JS\bloomai\src\server\http\skills-policy.ts`。
  - `D:\codeproject\JS\bloomai\src\server\http\routes\skill-package-runtime.ts`。
  - `D:\codeproject\JS\bloomai\src\server\skills\application\capability-grant.service.ts`。
  - `D:\codeproject\JS\bloomai\src\server\skills\policy\capability-policy.ts`。
  - `D:\codeproject\JS\bloomai\src\server\skills\policy\capability-broker.ts`。
- [x] **必须存在的符号/路径：**
  - `approveCapabilityGrant`、`rejectCapabilityGrant`、`revokeCapabilityGrant`。
  - Run approve/reject/cancel 相关 service/API/组件入口。
  - `/skill-capability-grants/:id/approve`、`/reject`、`/revoke`。
  - Grant Service 的 approve/reject/revoke。
  - Policy 和 Capability Broker 的入口及未审批拦截。
- [x] **建议验证命令：**
```powershell
rg -n "approveCapabilityGrant|rejectCapabilityGrant|revokeCapabilityGrant" src/renderer/api/index.ts src/renderer/pages/Skills/skill-runtime.store.ts
rg -n "skill-capability-grants/.+/(approve|reject|revoke)|waiting_approval" src/server/http/routes/skill-package-runtime.ts src/renderer/pages/Skills
rg -n "approveCapabilityGrant|rejectCapabilityGrant|revokeCapabilityGrant|waiting_approval|Capability Broker|capability" src/server/skills/application/capability-grant.service.ts src/server/skills/policy/capability-policy.ts src/server/skills/policy/capability-broker.ts
```
- [x] **预期结果：** 所有必要符号和路由仍存在；没有因为删除 UI import 而删除 API、Store 或服务端安全实现。
- [x] **验收标准：** 扫描命令有匹配；服务端相关单测/集成测试通过；任何缺失必须阻止进入最终验收。
- [x] **Dependencies：** Checkpoint C。
- [x] **Estimated scope：** 0.25 天；只读扫描和回归验证。

### Task 8 — 收敛测试契约并记录组件保留策略

- [x] **功能目标：** 测试明确区分“公开页面下线”和“底层权限组件保留”，避免后续维护者误删运行时安全能力。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillPermissionsWorkflow.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\SkillDetailWorkflow.test.tsx`。
  - `D:\codeproject\JS\bloomai\src\renderer\pages\Skills\run-detail.test.tsx`。
- [x] **精确修改点：**
  1. 保留 `SkillCapabilityPanel` 的 capability scope、budget、expiry、grant action 纯组件测试。
  2. 保留 Installation 和 Runtime 组件契约测试。
  3. 在测试描述或注释中说明：这些测试证明底层能力仍存在，不代表 `permissions` 是公开导航。
  4. 保留 Run Detail 的 `waiting_approval` 测试作为第一版人工审批入口回归。
- [x] **命令：**
```powershell
npx vitest run src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx src/renderer/pages/Skills/run-detail.test.tsx
```
- [x] **预期结果：** 组件内部权限契约和运行审批契约同时通过，且测试命名不再暗示权限管理页面必须存在。
- [x] **验收标准：** 没有通过删除底层测试来“修复”测试失败；没有删除 Capability/Installation 组件。
- [x] **Dependencies：** Task 7。
- [x] **Estimated scope：** 0.25 天；测试描述、静态契约和回归。

---

## 7. 集成验证、构建与最终验收

### Task 9 — 执行 Skills 目标测试、类型检查和构建

- [x] **功能目标：** 证明页面收敛没有造成类型错误、目标测试回归或生产构建失败。
- [x] **Files：** 无新增业务文件；只读取本计划列出的源文件和测试文件。
- [x] **命令：**
```powershell
cd D:\codeproject\JS\bloomai
npm run typecheck
npx vitest run src/renderer/pages/Skills/skills-navigation-shell.test.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/SkillsCenterCatalogActions.test.tsx src/renderer/pages/Skills/SkillsCenterCatalog.test.tsx src/renderer/pages/Skills/SkillDetailWorkflow.test.tsx src/renderer/pages/Skills/SkillPermissionsWorkflow.test.tsx src/renderer/pages/Skills/run-detail.test.tsx
npx playwright test src/renderer/pages/Skills/skills-center.e2e.ts
npm run build
```
- [x] **预期结果：** typecheck、目标 Vitest、Skills E2E、build 全部退出码为 0；不接受通过跳过测试、删除测试或压制 TypeScript 错误来“通过”。
- [x] **验收标准：** 保存命令输出或 CI 链接；若项目没有某个 script，必须记录实际可用的等价命令和原因，不能静默省略。
- [x] **Dependencies：** Task 8。
- [x] **Estimated scope：** 0.5 天；命令执行和失败修复。

### Task 10 — 最终范围检查、回滚说明和交付记录

- [x] **功能目标：** 交付一个可审阅、可回滚、没有意外后端权限变更的最小版本。
- [x] **Files：**
  - `D:\codeproject\JS\bloomai\docs\skills\007-skills-permissions-v1-minimal-implementation-plan.md`（更新执行记录/结果）。
  - 本计划列出的生产和测试文件。
- [x] **最终扫描命令：**
```powershell
git -C D:\codeproject\JS\bloomai status --short
git -C D:\codeproject\JS\bloomai diff --stat
git -C D:\codeproject\JS\bloomai diff -- src/renderer/pages/Skills/SkillsSidebar.tsx src/renderer/pages/Skills/SkillsCenterWorkbench.tsx src/renderer/pages/Skills/PackageDetailDrawer.tsx src/renderer/pages/Skills/SkillOverviewPanel.tsx
rg -n "id: 'permissions'|onOpenGrant|SkillCapabilityPanel|/skill-capability-grants/.+/(approve|reject|revoke)|waiting_approval" src/renderer/pages/Skills src/renderer/api src/server/http src/server/skills
```
- [x] **必须确认：**
  - 生产 UI 不再提供权限管理页面入口。
  - 旧权限 hash 降级到 Detail。
  - Catalog Pending Approval 直达 Run Detail。
  - Run Detail 仍提供批准、拒绝、取消。
  - Server Policy、Capability Broker、Grant Service、Grant routes、Renderer API/Store 未删除。
  - 没有新增 RBAC/角色表/migration。
  - 没有删除底层 Capability/Installation 组件。
  - 本次实现没有覆盖用户已有工作区改动。
- [x] **预期结果：** 变更范围只包含本计划目标和必要测试；审阅者可从 diff 复原每个 Task；失败时可按 Task 边界回滚。
- [x] **验收标准：** 所有前置 Task 已通过；工作区状态和 diff 已记录；无未解释的后端授权变更。
- [x] **Dependencies：** Task 9。
- [x] **Estimated scope：** 0.25 天；最终审计和文档收尾。

#### Task 10 执行记录（2026-08-12）

- **状态：** DONE（完成最终范围审计、回滚说明和交付证据记录；未新增业务代码）。
- **审计基线与提交边界：**
  - 当前分支为 `main`；`HEAD` 与 `origin/main` 均为 `0005630d927fee20567c088e3cf50166b3c8f20b`。
  - `git diff --name-status c663cf4..HEAD` 仅包含 12 个 Skills Renderer 页面/测试文件；没有 `src/server`、数据库 schema、migration、Policy、Broker、Grant Service 或 HTTP route 文件变更。
  - Task 1–9 的实现提交边界可按以下提交复核：`0dbfb20`、`e9124c5`、`4fadf16`、`ebba317`、`d75bfb8`、`e2c85be`、`0005630`。
  - 最终 `git status --short` 仅保留既有未跟踪内容：`.agents/` 与本计划文件；没有未提交的 tracked code diff。计划文件在 Task 10 中补充了本执行记录，但未纳入此前实现提交。
- **最终范围扫描：**
  - `SkillsSidebar.tsx` 的公开导航为 8 项，不再存在 `permissions` nav item 或“权限与安装”入口。
  - `decodeSkillsCenterState('#skills/tab=permissions&package=pkg-1')` 返回 `tab: 'detail'` 并保留 `selectedPackageId: 'pkg-1'`；重新编码不包含 `tab=permissions`。
  - `SkillsCenterWorkbench.tsx` 和 `PackageDetailDrawer.tsx` 不再挂载 Package Grant 管理面板或 Grant handler；Drawer 的版本、Manifest、Installation、Runs/History 和归档相关代码仍保留。
  - `SkillOverviewPanel.tsx` 的 Pending Approval 行使用 `onOpenRun(run.id)`；未发现 `onOpenGrant` 或 `openGrantContext` 生产入口。
  - Run Detail 仍挂载 `CapabilityApprovalCard`，`RunActionPanel` 对 `waiting_approval` 提供 `approve`、`reject`、`cancel` 三类动作。
  - Renderer API/Store 的 `approveCapabilityGrant`、`rejectCapabilityGrant`、`revokeCapabilityGrant`，Server Grant routes `/approve`、`/reject`、`/revoke`，以及 Policy/Capability Broker/Grant Service 相关入口均仍存在。
  - `SkillCapabilityPanel.tsx`、`SkillPermissionsPanel.tsx`、`SkillInstallationPanel.tsx` 均保留；保留组件测试没有被删除或绕过。
  - 变更范围未引入 RBAC、角色表、migration 或自动批准逻辑；未覆盖用户已有工作区改动。
- **新鲜验证证据（均为退出码 0）：**
  - `npm run typecheck`：TypeScript 检查通过。
  - 7 个目标 Vitest 文件：7 files / 39 tests passed。
  - `npm run test:skills:e2e`：16 files / 96 tests passed。
  - `skills-center.e2e.ts`：该文件实际是 Vitest 契约测试（导入 `vitest`），不是 Playwright Test 文件，且默认 Vitest glob 不匹配 `.e2e.ts`；通过 Vitest Node API 指定 include 执行，1 file / 2 tests passed。该等价命令和原因已记录，未静默跳过。
  - 服务端保留链路回归：`skill-package-runtime.test.ts`、`skill-package-runtime.p2-002.test.ts`、`capability-policy.test.ts`、`capability-broker.test.ts` 共 4 files / 40 tests passed。
  - `npm run build`：Renderer、Electron main、preload、server 均构建成功；仅有既有 chunk size warning，无构建错误。
  - `git diff --check`：通过。
- **回滚说明：**
  - 本版本没有数据库 schema 或服务端授权代码变更，不需要数据库回滚或数据修复。
  - 旧 hash 兼容问题按 Task 2 的 Workbench decoder 变更回滚；Workbench/Drawer UI 问题按 `e9124c5`、`4fadf16` 对应 Renderer 提交边界回滚；Pending 跳转问题按 `ebba317` 回滚；Run Detail 审批回归按 `d75bfb8` 回滚。回滚后重新执行 Task 9 的 typecheck、目标测试、Skills E2E 和 build。
  - `0005630` 仅是旧路由兼容类型别名的无行为变化整理；若需回滚，可单独 revert，不影响服务端安全链路。
- **剩余说明：** 广义扫描中仍会看到 decoder 兼容所需的字符串 `permissions`，以及被计划明确要求保留的 `SkillCapabilityPanel`；两者均不是公开导航或 Grant 管理入口，属于预期兼容/保留策略。

### Checkpoint D — Release gate

- [x] `permissions` 不再出现在公开导航、公开路由渲染分支或 Grant 管理入口。
- [x] `#skills/tab=permissions&package=...` 可降级为 Detail。
- [x] Pending Approval 唯一人工入口是 Run Detail。
- [x] `waiting_approval`、approve、reject、cancel 测试通过。
- [x] Renderer API/Store、Server Policy、Capability Broker、Grant Service、Grant routes 仍存在。
- [x] typecheck、目标 Vitest、Skills E2E、build 通过。
- [x] diff 检查确认没有 RBAC、migration 或服务端授权范围变化。

---

## 8. 回滚与风险

### 8.1 回滚策略

1. 本版本不改数据库 schema，不需要数据库回滚或数据修复。
2. 若旧链接兼容失败，优先回滚 Task 2 的 decoder 变更，不恢复公开权限导航；可以暂时将旧链接统一落到 Skills Center 并记录问题。
3. 若 Detail/Drawer 删除 Grant UI 造成版本、安装或 Run 入口回归，按 Task 3/4 分别回滚对应 Renderer diff，不回滚服务端安全链路。
4. 若 Run Detail 审批回归，回滚 Task 5 的 Pending 跳转改动，保留服务端和 Run 状态机；在修复跳转前不发布。
5. 回滚后必须重新执行 Task 9 的目标测试、E2E 和 build。

### 8.2 风险与处理

| 风险 | 影响 | 预防/检测 | 处理 |
|---|---|---|---|
| 旧 hash 仍落到未知 `permissions` 分支 | 用户看到空页或错误 | decoder 单测 + legacy E2E | 修正归一化并保留 package 参数 |
| 删除 Grant UI 时误删安装/版本逻辑 | Detail/Drawer 无法管理 Package | 组件工作流测试 + diff review | 按 Task 边界回滚并恢复遗漏逻辑 |
| Pending Approval 仍跳到已下线页面 | 用户无法审批 Run | 静态扫描 `onOpenGrant` + E2E 点击 | 改为 `onOpenRun(run.id)` |
| 为了“通过测试”删除底层权限组件 | 运行时安全能力丢失 | 保留组件测试和服务端符号扫描 | 恢复文件，阻止发布 |
| UI 隐藏被误解为授权关闭 | 未批准 Capability 可能执行 | Policy/Broker 回归测试 | 阻止发布，修复服务端拦截 |
| 用户已有未提交改动被覆盖 | 造成无关回归或数据丢失 | 每 Task 前后 `git status`/`git diff` | 停止执行，人工恢复工作区 |

---

## 9. 实施完成定义（DoD）

- [x] 代码只在允许的 Renderer 页面/测试范围内修改，且未覆盖用户已有改动。
- [x] 左侧“权限与安装”导航已移除，公开视图从 9 项变为 8 项。
- [x] 旧 `permissions` hash 降级为 `detail`，并保留 Package 选择上下文。
- [x] Workbench 和 Package Detail Drawer 不再挂载或操作 Package Grant 管理 UI。
- [x] Catalog Pending Approval 直接打开 Run Detail。
- [x] Run Detail 的 waiting approval / approve / reject / cancel 契约通过。
- [x] Renderer API/Store、Server Policy、Capability Broker、Grant Service、Grant routes 和底层组件保留。
- [x] 无新增 RBAC、角色表、数据库 migration 或自动批准逻辑。
- [x] typecheck、目标测试、Skills E2E、build 和最终 diff 检查均通过。

> **执行起点：** 先完成 Task 0 的基线与失败测试，再按 Task 1 → Task 10 顺序执行；未完成前不得把“页面下线”描述为“权限系统关闭”。
