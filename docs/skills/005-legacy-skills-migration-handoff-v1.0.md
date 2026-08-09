# Legacy Skills 迁移完成交接文档 v1.0

## 0. 文档元数据

- **状态**：迁移实施完成，M5 Legacy Runner 删除完成，发布门禁通过
- **交接日期**：2026-08-07
- **工作区**：`D:\codeproject\JS\bloomai`
- **分支**：`feat/migrate-legacy-skills`
- **迁移提交**：`d11a566 feat: migrate legacy skills to package runtime`
- **.superpowers 删除提交**：`623cb66 chore: remove .superpowers directory`
- **远端分支**：`origin/feat/migrate-legacy-skills`
- **源实施计划**：`D:\codeproject\JS\bloomai\docs\skills\004-legacy-skills-migration-implementation-plan-v1.0.md`
- **本文目的**：为后续维护者、发布负责人和 Agent 提供迁移完成后的事实基线、架构边界、验证证据及运行注意事项。

> 本文是交接摘要，不替代完整实施计划。阶段任务、验收用例、发布顺序和回滚层级以源实施计划为准。

---

## 1. 一句话结论

Legacy Skills 已从“可创建、可修改、可安装、可运行”的兼容执行系统迁移为**只读 Archive + Migration Control Plane**；新的执行路径统一进入 **Package Runtime**。Legacy Runner、Legacy 同步 Tool 和旧执行 barrel 已删除，Legacy 引用不能再创建新的 Run。

最终目标状态：

```text
Legacy = read-only archive
Legacy Run = permanently blocked
prompt-template = reviewed Package migration available
http-api = manual review only
js-function = critical blocked
Package Runtime = sole new execution plane
Chat = durable Package run only
Mastra = no legacy synchronous tool
historical data = retained and auditable
```

---

## 2. 事实来源和优先级

后续排查或继续开发时，按以下优先级确认事实：

1. **当前代码和测试**：以提交 `d11a566` 中的实现和测试为准。
2. **实施计划**：`D:\codeproject\JS\bloomai\docs\skills\004-legacy-skills-migration-implementation-plan-v1.0.md`，记录设计目标、阶段任务、验收标准、发布和回滚手册。
3. **离线验收脚本**：`D:\codeproject\JS\bloomai\scripts\verify-legacy-skills-migration.ts`。
4. **Package Runtime 及数据库迁移代码**：以当前 schema、repository、service 和 route 实现为准。
5. 若文档与代码发生冲突，应先暂停发布，确认是否需要新增 ADR 或修订实施计划；不得通过重新启用 Legacy fallback 来“临时修复”。

---

## 3. 最终架构

### 3.1 Archive Plane

Legacy 数据仍保留在历史 `skills` 记录中，可用于：

- 历史列表和详情读取
- 历史引用展示和复制
- migration inspect / preview
- migration history、审计和 source hash 追踪

Legacy Plane 已禁止：

- `create`
- `install`
- `update`
- `delete`
- Legacy `run`
- 运行队列、grant、artifact 或 worker 副作用

对应稳定错误码：

- `LEGACY_SKILL_FROZEN`
- `LEGACY_SKILL_RUN_DISABLED`

### 3.2 Migration Control Plane

迁移控制面负责读取 Archive、重新计算 source hash、生成报告并在人工确认后发布 Package：

- classifier：仅信任显式顶层 `type` 或 `kind`
- source normalizer：固定字段、默认值、排序和 JSON 序列化
- SHA-256：生成 `sourceSha256`
- secret redactor：处理 HTTP header、URL query、JSON body、环境变量和常见敏感字段
- preview：零执行、零网络、零 Package 写入
- validate：校验 owner、revision、source hash 和 Draft 状态
- publish：事务性创建 Package、Version、Snapshot、Installation、migration mapping 和 audit 记录
- retry：按 migration mapping 和 source hash 保证幂等

HTTP 路由：

```text
POST /api/v1/skills/:id/migration/inspect
POST /api/v1/skills/:id/migration/preview
POST /api/v1/skills/:id/migration/validate
POST /api/v1/skills/:id/migration/publish
GET  /api/v1/skills/:id/migration-history
```

发布必须满足：

- `previewId` 有效
- `expectedRevision` 匹配
- owner/tenant 上下文一致
- source hash 未变化
- `confirm=true`
- 所有 warning code 已在 `acknowledgedWarnings` 中确认

### 3.3 Package Plane

Package Runtime 是唯一的新执行平面，负责：

- Package / Version / Snapshot / Installation 生命周期
- durable Run 创建和状态机
- capability grant
- event 和 artifact
- provenance、source snapshot、manifest hash 和 rollback 保护

Package 引用必须使用显式命名空间：

```text
package:<package-or-version-id>
```

### 3.4 Chat 和 Mastra

- Chat 不再直接运行 Legacy Skill；Legacy 引用返回迁移提示，不创建 Run。
- Chat Package 请求进入 durable Package Runtime。
- Mastra 不再注册 `legacy_skill_<id>` 同步 Tool。
- `buildLegacySkillTools()` 返回空对象。
- Legacy Runner 采用 fail-closed 语义；本次 M5 后旧 Runner 文件已删除。

---

## 4. 迁移决策矩阵

| Legacy 类型 | 迁移结论 | 自动行为 | 人工/运行约束 |
|---|---|---|---|
| `prompt-template` | Package Draft Candidate | 生成规范化 Draft、变量信息和 warning | 必须 validate、人工确认并 publish 后才能进入 Package Runtime |
| `http-api` | Manual Review | 仅生成脱敏后的人工审查报告 | 不执行外部 HTTP；需人工确认 endpoint、headers、query、body、网络能力和安全策略 |
| `js-function` | Critical Blocked | 生成阻断报告，不执行 source | 禁止 `eval`、`new Function`、VM、动态 import、`child_process` 等任意 JavaScript 执行 |
| 缺失/伪造/冲突类型 | Unsupported | 生成 unsupported 报告 | 不得猜测类型，不得进入自动迁移或运行路径 |

稳定迁移错误码包括：

```text
LEGACY_MIGRATION_MANUAL_REVIEW
LEGACY_MIGRATION_CRITICAL_BLOCKED
LEGACY_MIGRATION_UNSUPPORTED_TYPE
LEGACY_MIGRATION_DAMAGED_SCHEMA
LEGACY_MIGRATION_SECRET_REDACTION_FAILED
LEGACY_MIGRATION_SOURCE_TOO_LARGE
LEGACY_MIGRATION_IDEMPOTENCY_CONFLICT
```

---

## 5. 主要文件地图

### 5.1 计划、脚本和数据库

- `D:\codeproject\JS\bloomai\docs\skills\004-legacy-skills-migration-implementation-plan-v1.0.md`
- `D:\codeproject\JS\bloomai\scripts\migrations\044-legacy-skill-migration-records.sql`
- `D:\codeproject\JS\bloomai\scripts\verify-legacy-skills-migration.ts`
- `D:\codeproject\JS\bloomai\src\server\db\schema.ts`
- `D:\codeproject\JS\bloomai\src\server\db\schema-contract.ts`
- `D:\codeproject\JS\bloomai\src\server\db\repositories\legacy-migration.repo.ts`
- `D:\codeproject\JS\bloomai\src\server\db\repositories\skill-package.repo.ts`

### 5.2 Migration 模块

目录：

```text
D:\codeproject\JS\bloomai\src\server\skills\migration
```

主要模块：

- `migration-classifier.ts`
- `source-normalizer.ts`
- `secret-redactor.ts`
- `prompt-template-migrator.ts`
- `manual-review-report.ts`
- `migration-preview.service.ts`
- `migration-control.service.ts`
- `migration.schemas.ts`
- `migration.types.ts`
- `migration-errors.ts`

### 5.3 HTTP、Service、引用和观测

- `D:\codeproject\JS\bloomai\src\server\http\routes\skill-migration.ts`
- `D:\codeproject\JS\bloomai\src\server\http\routes\skills.ts`
- `D:\codeproject\JS\bloomai\src\server\services\skill.service.ts`
- `D:\codeproject\JS\bloomai\src\server\services\skill-package-runtime.service.ts`
- `D:\codeproject\JS\bloomai\src\server\skills\application\legacy-skill.adapter.ts`
- `D:\codeproject\JS\bloomai\src\server\skills\application\skills-facade.service.ts`
- `D:\codeproject\JS\bloomai\src\server\skills\application\chat-skill-launcher.ts`
- `D:\codeproject\JS\bloomai\src\shared\skill-references.ts`
- `D:\codeproject\JS\bloomai\src\server\skills\observability\skill-runtime.metrics.ts`

### 5.4 已删除的 Legacy 执行文件

M5 已删除：

```text
D:\codeproject\JS\bloomai\src\server\skills\run-skill.ts
D:\codeproject\JS\bloomai\src\server\skills\js-function.ts
D:\codeproject\JS\bloomai\src\server\skills\http-api.ts
D:\codeproject\JS\bloomai\src\server\skills\prompt-template.ts
D:\codeproject\JS\bloomai\src\server\skills\registry.ts
D:\codeproject\JS\bloomai\src\server\skills\types.ts
D:\codeproject\JS\bloomai\src\server\skills\legacy\run-skill.ts
D:\codeproject\JS\bloomai\src\server\skills\legacy\js-function.ts
D:\codeproject\JS\bloomai\src\server\skills\legacy\http-api.ts
D:\codeproject\JS\bloomai\src\server\skills\legacy\prompt-template.ts
D:\codeproject\JS\bloomai\src\server\skills\legacy\mastra-tool-id.ts
```

Legacy registry 现在只保留 Archive registry 和冻结/运行阻断 guard。

---

## 6. 测试和验收证据

### 6.1 Release Gate

以下命令在 M5 删除后已通过：

```powershell
npm run test:skills:release-gate
```

结果：

- lint：通过
- skills typecheck：通过
- Unit：55 个测试文件，280 个测试通过
- Integration：5 个测试文件，28 个测试通过
- Security：2 个测试文件，35 个测试通过
- Migration：14 个测试文件，71 个测试通过
- E2E：2 个测试文件，2 个测试通过
- migration smoke：通过

### 6.2 离线验收

```powershell
npm run verify:legacy-skills-migration
```

最终结果：

```json
{
  "legacyReadOnly": true,
  "legacyRunBlocked": true,
  "promptTemplatePublished": true,
  "httpApiManualReview": true,
  "jsFunctionBlocked": true,
  "packageE2E": true,
  "secretLeak": false,
  "externalNetworkCalls": 0,
  "orphanedRecords": 0
}
```

### 6.3 最终静态扫描结论

M5 后未发现可达的 Legacy Runner import、`jsFunctionRunner`、`httpApiRunner`、`promptTemplateRunner`、`skillRunnerRegistry` 或 `SkillRunner` 类型。

扫描中的允许命中仅包括：

- migration schema 中的 `legacy_skill_id`
- migration 报告和阻断文案
- 安全测试及 E2E 中的恶意 source fixture
- 普通系统级 `child_process`
- 非 Legacy 的通用 `src/server/tools/node-runner.ts`
- 负向断言测试

### 6.4 关键行为验证

已验证：

- Legacy `POST /skills/:id/run` 返回 409，不创建 `skill_runs`
- Legacy create/install/update/delete 返回 409
- Legacy run 不入队、不创建 grant、不产生 artifact
- Package Run 只接受显式 `package:` 引用
- Chat Legacy 引用不创建 Run
- prompt-template 可完成 preview → validate → publish → install → grant → durable run → event/artifact
- HTTP API preview 不发起外部网络请求
- JS function source 永不执行
- secret 不出现在报告、审计和 artifact 中
- migration retry 不产生重复 Package 或孤儿记录

---

## 7. 发布、回滚和故障处置速查

### 7.1 发布前

1. 确认分支和提交：`feat/migrate-legacy-skills` / `d11a566`。
2. 执行 `npm run test:skills:release-gate`。
3. 执行 `npm run verify:legacy-skills-migration`。
4. 检查迁移 source hash、owner、revision 和 migration history。
5. 检查没有新的 Legacy Runner import 或同步 Tool 注册。

### 7.2 运行期处置

- **收到 Legacy Run 请求**：预期返回 `LEGACY_SKILL_RUN_DISABLED`；不要恢复旧 Runner，改为引导用户执行 inspect/preview。
- **收到 Legacy 写请求**：预期返回 `LEGACY_SKILL_FROZEN`；确认 Archive 数据仍可读。
- **preview 失败**：先检查 source schema、显式 type/kind、source 大小和 secret redaction 结果。
- **validate/publish revision conflict**：重新执行 preview，确认 source hash 和 expected revision 后再操作。
- **HTTP API manual review**：人工复核网络目标、headers、query、body、凭据和能力策略，不能把报告直接转成可执行 Package。
- **JS function critical blocked**：保持阻断；不得通过改名、fallback、VM 或动态 import 绕过策略。
- **Package publish 事务失败**：检查 migration mapping、Package provenance、snapshot hash 和审计记录；利用事务回滚，不手工补写半成品记录。
- **Package Runtime 回归**：优先回滚 Package 发布或安装状态，不回滚 Archive 只读和 Legacy 永久阻断规则。

### 7.3 回滚原则

回滚按层级处理：

1. 业务层：禁用新 Package 安装或运行入口。
2. Package 层：依据 mapping、provenance 和 snapshot 做版本/安装回滚。
3. 数据层：恢复事务一致性，保留 migration record、审计和 source hash。
4. 代码层：仅回滚迁移提交或发布版本；不得恢复 Legacy Runner 到生产执行面。

Legacy 历史记录和迁移审计数据原则上保留，除非有明确的数据保留策略和审批。

---

## 8. 当前工作区状态和后续动作

迁移提交已经推送，迁移相关修改没有遗留在 staged 区域。当前工作区仍存在此前已存在的无关修改/未跟踪文件，例如：

- `D:\codeproject\JS\bloomai\docs\MCP\2026-08-02-bloomai-mcp-client-implementation-plan.md`
- `D:\codeproject\JS\bloomai\docs\skills\001-skills-system-refactor-analysis-v1.1.md`
- `D:\codeproject\JS\bloomai\docs\skills\002-skills-system-refactor-implementation-plan-v1.1.md`
- `D:\codeproject\JS\bloomai\docs\superpowers\plans\2026-08-05-bloomai-windows-icon.md`
- `D:\codeproject\JS\bloomai\release-icon-verify\`
- `D:\codeproject\JS\bloomai\installer-ranges.txt`

这些文件不是本次迁移提交的一部分，后续 Agent 禁止使用 `git reset --hard` 或 `git clean` 清理它们。

本文写入后属于新的交接文档；是否将本文单独提交和推送，应由维护者根据团队发布流程决定。若需要提交，建议使用独立提交，例如：

```powershell
git add docs/skills/005-legacy-skills-migration-handoff-v1.0.md
git commit -m "docs: add legacy skills migration handoff"
git push origin feat/migrate-legacy-skills
```

提交前应再次执行：

```powershell
git diff --check
npm run typecheck:skills
npm run verify:legacy-skills-migration
```

---

## 9. Definition of Done 快照

- [x] Legacy 为只读 Archive
- [x] Legacy Run 永久阻断
- [x] Legacy create/install/update/delete 永久阻断
- [x] prompt-template 支持人工确认后的 Package 迁移
- [x] http-api 仅人工审查
- [x] js-function critical blocked
- [x] Package Runtime 成为唯一新的执行平面
- [x] Chat 使用 durable Package Run
- [x] Mastra 不注册 Legacy 同步 Tool
- [x] 历史数据、migration mapping、source hash 和审计可追溯
- [x] M5 Legacy Runner 删除完成
- [x] unit、integration、security、migration、E2E 和 release gate 通过
- [x] 迁移提交已推送到 `origin/feat/migrate-legacy-skills`
- [ ] 本 handoff 文档是否单独提交，待维护者决定

---

## 10. 建议下一位 Agent 使用的 Skills

- `verification-before-completion`：任何继续修改、提交或发布前，重新执行证据型验证。
- `finishing-a-development-branch`：需要完成分支收尾、提交或创建 PR 时使用。
- `documentation-and-adrs`：若修改迁移架构、错误码、数据模型或发布策略，补充 ADR 或更新事实来源。
- `deprecation-and-migration`：继续处理 Legacy 残余消费者、历史数据或下游迁移时使用。
- `executing-plans`：若继续执行未完成的计划任务，严格按 `004-legacy-skills-migration-implementation-plan-v1.0.md` 的阶段门禁推进。
- `code-review-and-quality`：若要审查 Package provenance、事务幂等、安全边界或回滚实现，先做多轴代码审查。

---

## 11. 交接结束语

本次迁移的核心不是“保留旧接口并换一个实现”，而是完成执行平面的边界收敛：Legacy 只负责历史读取和可审计迁移，Package Runtime 负责所有新的运行行为。后续任何需求如果需要重新启用 Legacy 执行，都必须先重新评估安全边界、数据模型、回滚策略和架构决策，不能通过新增 fallback import 或恢复已删除 Runner 来实现。