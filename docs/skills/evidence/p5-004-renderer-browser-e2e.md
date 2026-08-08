# P5-004 Renderer 和浏览器 E2E 证据

- **Task ID**：`SKL12-P5-004`
- **分支**：`feat/skills-admin-system`
- **生成时间**：2026-08-08T18:00:25Z（UTC）
- **提交**：本文件随 P5-004 独立提交；最终 SHA 可通过 `git log --follow --format=%H -- docs/skills/evidence/p5-004-renderer-browser-e2e.md` 复核。

## 门禁范围

将 `test:skills:e2e` 从只运行 `tests/e2e/skills` 扩展为同时运行 `src/renderer/pages/Skills` 和浏览器验收目录，纳入以下 Renderer 合同：

- Skills Center catalog、KPI、搜索/筛选/分页/状态和空/错误投影：`SkillsCenterCatalog.test.tsx`、`SkillsCenterWorkbench.test.tsx`；
- 四个行内图标 action 的顺序、toggle、tooltip、focus、aria-label、卸载单确认：`SkillsCenterCatalogActions.test.tsx`；
- Import inspect/review/install source mapping、diagnostics 和 review state：`PackageInstallDialog.test.tsx`；
- Creator draft、validate、preview、publish 证据门槛和 Package Runtime 导航：`SkillCreatorWorkbench.test.tsx`；
- Detail/version/diff/grant/run/artifact、permissions/installations、runs/artifacts/settings、SSE reconnect/cancel/retry：`SkillDetailWorkflow.test.tsx`、`SkillPermissionsWorkflow.test.tsx`、`run-detail.test.tsx`、`SkillsRunArtifactsSettingsWorkflow.test.tsx`；
- API adapter、DTO normalization、store refresh/error/optimistic rollback/reconnect/idempotency：`skill-runtime.api.test.ts`、`skill-runtime.store.test.ts`；
- health/diagnostics、安全字段和 generic error state：`SkillRuntimeDiagnostics.test.tsx`；
- 1120px/860px responsive、keyboard focus、minimum target、semantic status and a11y contracts：`SkillsVisualResponsiveA11yWorkflow.test.tsx`、`skills-navigation-shell.test.tsx`；
- Renderer 中不存在 Legacy entry/route/store：`SkillsLegacyBoundaryP4.test.tsx`；
- offline browser flow：`tests/e2e/skills/skill-runtime.browser.test.ts`，覆盖 Skills Center → inspect/install/enable → Run Detail → approve → artifact → export，以及 Creator validate/preview/publish，并断言无外部网络请求。

## 验收命令与结果

```text
npm run test:skills:e2e
```

结果：**16 test files passed，86 tests passed，退出码 0**；其中浏览器验收 1 test passed，Vitest duration 21.80s。

浏览器测试成功保留了 trace/video（本地临时证据，不提交原始二进制）：

```text
.tmp/skills-evidence/browser-PHJ0J5/skill-runtime.browser.trace.zip
.tmp/skills-evidence/browser-PHJ0J5/page@997d50f2fc9b504660af1faf3ef995d2.webm
```

另执行：

```text
git diff --check
```

结果：通过，无 whitespace error。

## 验收结论

- [x] Renderer API/store、组件、主工作台、Creator、Detail、Permissions、Runs、Artifacts、Settings 测试纳入 gate。
- [x] Catalog search/filter/pagination/status、四个 inline actions、危险卸载确认和键盘/tooltip/aria contracts 纳入 gate。
- [x] Import inspect → review → install、Creator draft → validate → preview → publish、Run → Artifact → export 浏览器流程通过。
- [x] 860px/1120px 响应式和无 Legacy 入口合同通过。
- [x] 16 files / 86 tests 全部通过；浏览器 flow 未发生外部网络请求。

## 限制、风险与回滚

浏览器用例是离线 deterministic harness，真实 Electron backend/remote service 的网络链路不在本次 P5 gate 中；真实 UI 的 860px/1120px 约束由 Renderer contract tests 覆盖。门禁新增的 15 个 Renderer 测试文件会增加执行时间约 22 秒。回滚方式为回退本任务独立 commit，恢复只运行 `tests/e2e/skills` 的旧命令集合。
