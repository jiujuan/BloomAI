# Release A0 验收证据

日期：2026-08-03
分支：`feat/tools-platform-impl`

## 目标

冻结工具可用性基线，禁止三个 placeholder 工具被误报为可用能力。

## 实现证据

- 新增 `src/server/tools/availability.ts`，统一返回 `available`、`dependency_missing`、`configuration_missing`、`unsupported_platform` 和 `disabled` 状态。
- `web_screenshot`、`ocr`、`image_edit` 分别返回 `dependency_missing`，不再返回成功 note。
- 新增 `scripts/migrations/026-disable-placeholder-tools.sql`，只将 builtin 的三个 placeholder 工具设置为 `is_enabled = 0`，不删除历史运行记录。
- Agent、Capability Broker、HTTP service 和 Tools UI 都读取 availability；不可用工具不会暴露给 Agent，也不能从 UI 手动运行。

## 自动化测试

执行命令：

```text
npx vitest run src/server/tools/availability.test.ts src/renderer/pages/Tools/ToolTestRunner.test.tsx src/server/http/routes/tools.test.ts src/server/db/migrations.test.ts
npm run typecheck
npm run build
```

结果：

- 定向测试：4 个测试文件、16 个测试通过。
- 迁移测试：26 个版本化迁移可从空库执行；旧库升级时第 026 迁移会禁用三个 placeholder 工具。
- typecheck：通过。
- build：通过；Vite 仅报告既有 bundle chunk size warning。
- `git diff --check`：通过。

## 验收映射

| 验收项 | 证据 |
|---|---|
| 新安装数据库默认禁用三个 placeholder | `src/server/db/migrations.test.ts` 的迁移测试，以及 `availability.test.ts` 的 seed 检查 |
| 旧数据库升级后禁用三个 placeholder | `src/server/db/migrations.test.ts` 的 A0 upgrade 测试 |
| Agent 不暴露 unavailable 工具 | `src/server/tools/availability.test.ts` |
| HTTP 返回 availability 和 reason | `src/server/http/routes/tools.test.ts` 请求 `/tools?category=web` |
| UI 不允许运行 unavailable 工具 | `src/renderer/pages/Tools/ToolTestRunner.test.tsx` |

## 结论

Release A0 验收通过。三个 placeholder 工具保持显式不可用，等待后续真实依赖、配置和功能实现；本 Release 不自动重新启用它们。
