# SKL12-P1-009 Runtime Health、Diagnostics、Audit 和 Metrics 验收证据

- **Task ID:** `SKL12-P1-009`
- **分支:** `feat/skills-admin-system`
- **责任人:** Codex
- **验收日期:** 2026-08-08
- **证据生成时间:** 2026-08-08T03:13:17Z
- **验收状态:** **PASS（待提交 SHA 补录）**
- **实施计划:** `docs/skills/006-skills-admin-v1.2-implementation-plan.md` §6.2 / SKL12-P1-009
- **提交:** 实现提交与本证据更新提交将在本文件完成后生成，并在提交后补录 SHA。

## Red 阶段证据

在 canonical health 三态、logger `versionId` normalization 和 audit DTO fixture 完成后，先运行 P1-009 目标测试。结果为 `8 test files / 65 tests`，其中 `63 passed / 2 failed`，exit code `1`。失败均为旧断言与新契约不一致，不是运行时业务失败：

1. `skill-runtime.diagnostics.test.ts` 仍断言旧的 `status: 'not_ready'`，实际 canonical 状态为 `status: 'disabled'`，并保留 `legacyStatus: 'not_ready'`。
2. `skill-runtime.logger.test.ts` 的 exact correlation 断言缺少新增 canonical `versionId` 字段。

同时，`skill-runtime-observability.test.ts` 的新增 audit fixture 缺少 `AuditEventSnapshot.actor`，由 `typecheck:skills` 暴露并补齐为脱敏的 `actor: 'admin'` 测试值。

## Green 实现

### Runtime Health / Diagnostics

- `RuntimeHealth` 增加 canonical 三态：`healthy | degraded | disabled`，同时输出 `availability` 和兼容旧消费者的 `legacyStatus: ready | not_ready | degraded`。
- runtime disabled 时返回 `disabled`；package execution disabled、migration pending 或 worker crashed 时返回 `degraded`；runtime、package execution、migration 和 worker 正常时返回 `healthy`。
- diagnostics 保留 queue、worker、migration、policy、recent failures 和 metrics 快照；错误信息通过现有安全清理逻辑脱敏，不输出测试中的 `hidden` 内容。

### Structured Logger

- correlation 统一规范化 `requestId`、`runId`、`packageId`、canonical `versionId` 等字段。
- 传入旧字段 `skillVersionId` 时自动补充 `versionId`，并保留 `skillVersionId` 兼容字段。
- prompt、raw input、authorization/token/secret 等敏感值继续在 details、message 和 sink entry 中脱敏；correlation 传播由 `withSkillCorrelation()` / `getSkillCorrelation()` 覆盖。

### Metrics

- 保留 queue、run、artifact、capability、migration 和 import-reject 指标，并新增 install、approval、error、Legacy reject 指标。
- 新增 `installCount`、`approvalCount`、`errorCount`、`legacyRejectCount`、`installsByOutcome`、`approvalsByAction`、`errorsByCode`。
- `PackageInstaller.install()` 对每次安装只记录一次最终 install outcome（`success` / `partial_failure` / `error`）和 `durationMs`；telemetry 异常不会改变安装结果。
- runtime service 的 approve/reject 和统一错误映射记录 approval/error metric；metrics sink 异常不会改变审批结果或业务错误。
- correlation ID 不写入 metrics attributes；Legacy run 被阻断时自动计入 Legacy reject。

### Audit API / Repository

- 增加 `GET /api/v1/skill-runtime/audit`，只允许 administrator 访问。
- `limit` 范围为 `1..100`，默认 `20`；`offset >= 0`，默认 `0`；支持 `action`、`resourceType`、`resourceId` 过滤。
- 使用统一 `pageSuccess()` 返回分页元数据；SQLite repository 按 `created_at DESC, id DESC` 稳定排序。
- audit payload 解析对损坏 JSON、数组和非 object JSON 安全降级为 `{}`，避免敏感/非对象载荷污染 DTO。

### Renderer Diagnostics

- Renderer 类型支持 canonical health 状态、`availability` 和 `legacyStatus`，优先使用 `availability`，兼容旧 `ready/not_ready` 响应。
- runtime check failed 强制展示 `Disabled`；healthy/ready、degraded、disabled 分别使用 success/warning/muted 视觉语义。
- 新增 Runtime Metrics card，展示 Installs、Approvals、Queue、Runs、Artifacts、Errors 和 Legacy rejects。

## 自动化测试证据

### P1-009 完整目标测试

```powershell
npm test -- --run `
  src/server/skills/observability/skill-runtime.diagnostics.test.ts `
  src/server/skills/observability/skill-runtime.logger.test.ts `
  src/server/skills/observability/skill-runtime.metrics.test.ts `
  src/server/http/routes/skill-runtime-observability.test.ts `
  src/renderer/pages/Skills/SkillRuntimeDiagnostics.test.tsx `
  src/server/db/repositories/skill-package.repo.test.ts `
  src/server/skills/packages/package-installer.test.ts `
  src/server/services/skill-package-runtime.service.test.ts
```

结果：`8 test files passed / 65 tests passed / exit code 0`。

覆盖的新增/更新证据包括：

- health canonical 三态、legacy status 兼容和敏感错误清理；
- logger correlation、`skillVersionId -> versionId` normalization、prompt/raw input/secret 脱敏；
- install、approval、error、Legacy reject metric 及非阻塞 wrappers；
- audit admin authorization、分页/筛选、DTO actor、repository 排序和 payload 安全降级；
- PackageInstaller 最终 install outcome、duration 和 telemetry non-blocking；
- runtime service approve/reject/error metric，以及 metrics failure 不影响业务结果；
- Renderer 状态优先级、Disabled fallback 和 Runtime Metrics card。

### 类型与差异检查

```powershell
npm run typecheck:skills
git diff --check
```

结果：

- `npm run typecheck:skills`: exit code `0`，`tsc --noEmit -p tsconfig.skills.json` 通过；
- `git diff --check`: exit code `0`；Git 仅报告工作区 LF/CRLF 转换提示，无 whitespace error。

## 变更文件

- `src/server/skills/application/ports.ts`
- `src/server/db/repositories/skill-package.repo.ts`
- `src/server/http/routes/skill-runtime-observability.ts`
- `src/server/http/routes/skill-runtime-observability.test.ts`
- `src/server/skills/observability/skill-runtime.diagnostics.ts`
- `src/server/skills/observability/skill-runtime.diagnostics.test.ts`
- `src/server/skills/observability/skill-runtime.logger.ts`
- `src/server/skills/observability/skill-runtime.logger.test.ts`
- `src/server/skills/observability/skill-runtime.metrics.ts`
- `src/server/skills/observability/skill-runtime.metrics.test.ts`
- `src/server/skills/packages/package-installer.ts`
- `src/server/skills/packages/package-installer.test.ts`
- `src/server/services/skill-package-runtime.service.ts`
- `src/server/services/skill-package-runtime.service.test.ts`
- `src/renderer/pages/Skills/skill-runtime.types.ts`
- `src/renderer/pages/Skills/SkillRuntimeDiagnostics.tsx`
- `src/renderer/pages/Skills/SkillRuntimeDiagnostics.test.tsx`
- `docs/skills/evidence/p1-009-runtime-observability.md`

## 工作区隔离

本任务只应提交上面的 P1-009 文件。用户已有的文档、HTML、图标资源和 `docs/MCP/2026-08-02-bloomai-mcp-client-implementation-plan.md` 改动不属于本任务，必须保持未暂存、未提交。

## 已知限制与后续边界

- 本证据覆盖 P1-009 的领域单测、路由单测、Repository/installer/runtime service 集成测试和 Renderer 组件测试；未将 P3 浏览器验收或完整应用启动作为 P1-009 的替代证据。
- health endpoint 的 admin/非 admin 语义由 route tests 覆盖；实际生产身份解析仍由上层认证中间件提供，默认 fallback 只读取 `x-bloom-role: admin`。

## 提交与推送

- **实现提交 SHA:** 待提交后补录。
- **证据更新提交 SHA:** 待提交后补录。
- **推送目标:** `origin/feat/skills-admin-system`。
