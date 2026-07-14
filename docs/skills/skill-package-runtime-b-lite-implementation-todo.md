# Skill Package Runtime B-Lite 实施计划 TODO

> 状态：Draft  
> 日期：2026-07-14  
> 目标：保留旧 Skills 系统，新增安全、可恢复的 Skill Package Runtime B-Lite，并以 AI 画图页面的文章配图作为首个业务闭环。  
> 关联文档：
> - [第三方复杂 Skills 运行时架构设计](./third-party-skills-runtime-architecture.md)
> - [Skill Package Runtime 前端操作与产品集成方案](./skill-package-runtime-ux-and-integration-design.md)

## 1. 范围约束

### 1.1 B-Lite 首期支持

- `SKILL.md` 目录型 Skill。
- `references/` 和只读 `assets/`。
- 本地目录、ZIP、GitHub Archive 安装。
- Instruction Agent 编排。
- Web、用户上传附件读取、图片生成。
- 持久化运行状态、审批、事件和 Artifacts。
- AI 画图页面中的文章配图闭环。

### 1.2 B-Lite 首期不支持

- Python、Shell。
- 自动安装依赖。
- MCP、容器、子 Agent。
- 任意工作区写入。
- 读取用户 Home 配置。
- 自动更新和复杂 Skill Market。
- Chat 内直接展示批量图片结果。

## 2. TODO 00：建立实施基线

- [ ] 为 B-Lite 定义功能开关 `skill_package_runtime_enabled`。
- [ ] 记录当前旧 Skills API、数据库和 UI 行为。
- [ ] 为现有三类 Skill 补最小回归测试。
- [ ] 确认旧 `js-function`、`http-api`、`prompt-template` 不迁移。
- [ ] 删除 `tool.repo.ts` 中重复的 `skillRepo`，统一使用 `skill.repo.ts`。
- [ ] 建立 B-Lite 目录结构。

建议结构：

```text
src/server/skills/
  legacy/
  packages/
  runtime/
  policy/
  artifacts/
  adapters/
```

验收：

- [ ] 旧 Skills 安装和运行行为保持不变。
- [ ] 新 Runtime 可通过功能开关关闭。

## 3. TODO 01：数据库迁移系统

当前 `CREATE TABLE IF NOT EXISTS` 无法可靠升级已有表，必须先解决迁移问题。

- [ ] 新增 `schema_migrations` 表。
- [ ] 建立顺序迁移执行器。
- [ ] 迁移过程支持事务。
- [ ] 迁移重复运行具有幂等性。
- [ ] 应用启动时在 seed 前运行迁移。
- [ ] 增加空数据库迁移测试。
- [ ] 增加旧版本数据库升级测试。
- [ ] 增加迁移失败回滚测试。

迁移文件建议：

```text
scripts/migrations/
  001-skill-runtime-core.sql
  002-skill-runtime-events.sql
  003-skill-runtime-artifacts.sql
  004-skill-capability-grants.sql
```

## 4. TODO 02：B-Lite 数据模型

新增表：

- [ ] `skill_packages`。
- [ ] `skill_versions`。
- [ ] `skill_installations`。
- [ ] `skill_runs_v2`。
- [ ] `skill_run_events`。
- [ ] `skill_artifacts`。
- [ ] `skill_capability_grants`。

核心关系：

```text
SkillPackage
  -> SkillVersion（不可变）
  -> SkillInstallation（当前启用版本）
  -> SkillRun（锁定具体版本）
     -> SkillRunEvent
     -> SkillArtifact
```

`skill_runs_v2` 至少包含：

- [ ] `skill_version_id`。
- [ ] `status`。
- [ ] `revision`。
- [ ] `input_json`。
- [ ] `output_json`。
- [ ] `context_json`。
- [ ] `surface`。
- [ ] `session_id`。
- [ ] `image_session_id`。
- [ ] `waiting_reason`。
- [ ] `cancel_requested`。
- [ ] `started_at`。
- [ ] `updated_at`。
- [ ] `finished_at`。
- [ ] `error_code`。
- [ ] `error_message`。

约束：

- [ ] `skill_run_events(run_id, seq)` 唯一。
- [ ] Artifact 只能关联一个有效 Run。
- [ ] Run 必须锁定不可变 SkillVersion。
- [ ] 删除安装记录不能破坏历史运行。
- [ ] 所有 JSON 字段在仓储边界进行 Zod 校验。

## 5. TODO 03：统一 Capability Broker

这是最高优先级安全任务。

- [ ] 新增 `CapabilityBroker`。
- [ ] 将工具启用状态检查移入 Broker。
- [ ] 将权限检查移入 Broker。
- [ ] 将审批判定移入 Broker。
- [ ] 将超时和审计统一到 Broker。
- [ ] Chat、Workflow、HTTP、Skill Runtime 全部通过 Broker。
- [ ] 禁止 Package Runtime 直接调用 `executeTool()`。
- [ ] 保留 `executeTool()` 作为内部执行器，不作为授权边界。

建议接口：

```ts
executeCapability({
  caller,
  capability,
  input,
  runId,
  sessionId,
  grantContext,
}): Promise<CapabilityResult>
```

B-Lite 首期允许：

- [ ] `web.search`。
- [ ] `web.fetch`。
- [ ] `document.read_uploaded`。
- [ ] `package.read`。
- [ ] `artifact.write`。
- [ ] `image.generate`。

明确拒绝：

- [ ] `shell.execute`。
- [ ] `python.execute`。
- [ ] `dependency.install`。
- [ ] `workspace.write`。
- [ ] `home.read`。

验收：

- [ ] Package Skill 无法绕过权限直接执行工具。
- [ ] 所有调用可关联 `runId` 和 `toolRunId`。
- [ ] 图片生成可以限制模型和最大调用次数。

## 6. TODO 04：权限和预算策略

- [ ] 定义 `SkillCapability` 联合类型。
- [ ] 定义 `once/session/persistent` 授权模式。
- [ ] 授权绑定 `skill_version_id`。
- [ ] 支持文件根目录范围。
- [ ] 支持网络域名范围。
- [ ] 支持图片模型 allowlist。
- [ ] 支持图片调用次数预算。
- [ ] 支持授权过期时间。
- [ ] Skill 更新后重新计算权限差异。
- [ ] 新版本新增权限时撤销旧授权继承。
- [ ] 保存授权人、时间和作用范围。

文章配图运行授权示例：

```json
{
  "capabilities": {
    "document.read_uploaded": true,
    "artifact.write": true,
    "image.generate": {
      "maxCalls": 6,
      "allowedModels": ["agnes-image-2.1-flash"]
    }
  }
}
```

## 7. TODO 05：Package Installer

- [ ] 支持本地目录安装。
- [ ] 支持 ZIP 安装。
- [ ] 支持 GitHub Archive URL。
- [ ] 支持仓库中的指定子目录。
- [ ] 固定 Git commit SHA。
- [ ] 下载和解压到 staging 目录。
- [ ] 校验后原子移动到不可变版本目录。
- [ ] 计算所有文件 hash。
- [ ] 计算 manifest hash。
- [ ] 保存 package 来源信息。
- [ ] 支持一个仓库发现多个 `SKILL.md`。
- [ ] 安装过程不执行任何脚本。

安全限制：

- [ ] 限制压缩包总大小。
- [ ] 限制文件数量。
- [ ] 限制单文件大小。
- [ ] 拒绝绝对路径。
- [ ] 拒绝 `../` 路径穿越。
- [ ] 拒绝符号链接和硬链接。
- [ ] 拒绝写入 Package 根目录之外。
- [ ] 拒绝嵌套压缩炸弹。
- [ ] 不读取仓库中的 `.env` 或凭据文件。

安装状态：

```text
downloading
-> inspecting
-> awaiting_permission_review
-> installed
-> rejected / failed
```

## 8. TODO 06：Manifest Resolver

- [ ] 解析 `SKILL.md` frontmatter。
- [ ] 支持缺少 frontmatter 的兼容模式。
- [ ] 发现 `references/`。
- [ ] 发现只读 `assets/`。
- [ ] 发现 `scripts/`，但标记为 B-Lite 不支持。
- [ ] 生成标准化 `SkillManifest`。
- [ ] 推导 capabilities。
- [ ] 推导推荐运行页面。
- [ ] 推导输出 Artifact 类型。
- [ ] 验证入口路径位于 Package 根目录。
- [ ] 对未知字段保持向前兼容。
- [ ] Manifest 校验失败时阻止安装。

B-Lite Runtime 固定为：

```ts
runtime: 'instruction-agent'
```

遇到以下声明则标记不兼容：

```text
script
python
shell
mcp-plugin
install_dependencies
```

## 9. TODO 07：安全文件加载器

- [x] 新增 `SkillPackageReader`。
- [x] 使用 canonical path 判断路径归属。
- [x] 完整读取入口 `SKILL.md`。
- [x] References 按需加载。
- [x] Assets 只读访问。
- [x] 限制单次读取大小。
- [x] 限制单次运行读取文件数。
- [x] 禁止目录外路径。
- [x] 禁止设备文件和特殊文件。
- [x] 记录已加载文件的 hash。
- [x] 事件中只记录路径和摘要，不保存超长全文。

不应完全依赖 LLM 判断何时加载 references。由 Loader 提供受控能力：

```text
package.list_files
package.read_text
package.read_asset
```

## 10. TODO 08：持久化 Skill Run 状态机

- [x] 新增 `SkillRunCoordinator`。
- [x] `startRun()` 只返回 `runId`。
- [x] `dispatchCommand()` 处理确认、修改和取消。
- [x] `subscribeEvents()` 支持 `afterSeq`。
- [x] `getRun()` 返回当前状态。
- [x] 所有状态转换通过单一状态机。
- [x] 使用 `revision` 防止并发覆盖。
- [x] Command 支持幂等键。
- [x] 应用启动后将遗留 `running` 标记为 `interrupted`。
- [x] 支持恢复 interrupted Run。
- [x] 支持 `cancel_requested`。
- [x] 支持 `completed_with_errors`。

状态：

```text
created
validating
running
waiting_input
waiting_approval
completed
completed_with_errors
failed
cancelled
interrupted
```

事件仅用于观察和重放，不能作为唯一状态来源。

## 11. TODO 09：事件协议与脱敏

- [x] 定义稳定的 `SkillRunEvent` discriminated union。
- [x] 为事件增加 `seq`。
- [x] 为事件增加 schema version。
- [x] 增加输入摘要事件。
- [x] 增加文件加载事件。
- [x] 增加步骤事件。
- [x] 增加 Capability 调用事件。
- [x] 增加审批事件。
- [x] 增加 Artifact 事件。
- [x] 增加完成、部分完成和失败事件。
- [x] 对 headers、token、API key 脱敏。
- [x] 大文本改存 Artifact，只在事件中保存引用。
- [x] Base64 图片不得写入事件表。
- [x] 限制单事件 payload 大小。

## 12. TODO 10：Artifact Store

- [ ] 为每个 Run 建立隔离目录。
- [ ] Artifact 目录不可由 Skill 自由指定。
- [ ] 支持 Markdown。
- [ ] 支持 JSON。
- [ ] 支持 prompt。
- [ ] 支持 image reference。
- [ ] 支持 directory manifest。
- [ ] 计算文件大小和 hash。
- [ ] 校验 MIME 类型。
- [ ] 通过 Artifact ID 读取内容。
- [ ] Renderer 不接收原始本地绝对路径。
- [ ] 支持用户导出到选定目录。
- [ ] 删除 Run 时定义 Artifact 保留策略。

路径建议：

```text
<dataDir>/skills/
  packages/
  staging/
  runs/<runId>/artifacts/
```

## 13. TODO 11：Instruction Agent Adapter

- [x] 新增 `InstructionAgentAdapter`。
- [x] 从 SkillVersion 读取 `SKILL.md`。
- [x] 将用户输入和 Manifest 转换为运行上下文。
- [x] 只暴露允许的 capabilities。
- [x] 不把所有安装 Skill 注入同一上下文。
- [x] 对 references 使用按需读取。
- [x] 限制最大 Agent steps。
- [x] 限制模型 token 消耗。
- [x] 支持等待用户输入。
- [x] 支持等待能力审批。
- [x] 支持取消。
- [x] 将最终结果标准化为 Run output。

首期不实现通用工作流 DSL，先让 Instruction Agent 通过受控能力完成流程。

## 14. TODO 12：Image Studio Adapter

文章配图 Skill 不应直接使用简单 `image_gen` 返回值。

- [x] 新增 `ImageStudioCapabilityAdapter`。
- [x] 创建或关联 `image_session`。
- [x] 复用 `generateForSession()`。
- [x] 每张图创建 `image_generations` 记录。
- [x] 将 Generation ID 关联到 Skill Artifact。
- [x] 支持最大并发数，首期建议为 2。
- [x] 支持每张图独立状态。
- [x] 支持单图重试。
- [x] 支持修改 prompt 后重试。
- [x] 支持跳过失败图片。
- [x] 支持整组取消。
- [x] 输出 Markdown 插图清单。
- [x] 运行结束计算 `completed` 或 `completed_with_errors`。

## 15. TODO 13：HTTP API

Package：

- [ ] `POST /skill-packages/inspect`。
- [ ] `POST /skill-packages/install`。
- [ ] `GET /skill-packages`。
- [ ] `GET /skill-packages/:id`。
- [ ] `DELETE /skill-installations/:id`。

Runs：

- [ ] `POST /skill-runs`。
- [ ] `GET /skill-runs`。
- [ ] `GET /skill-runs/:id`。
- [ ] `GET /skill-runs/:id/events?afterSeq=`。
- [ ] `POST /skill-runs/:id/commands`。
- [ ] `POST /skill-runs/:id/cancel`。
- [ ] `GET /skill-runs/:id/artifacts`。

Artifacts：

- [ ] `GET /skill-artifacts/:id/content`。
- [ ] `POST /skill-artifacts/:id/export`。

接口要求：

- [ ] 全部输入使用 Zod 校验。
- [ ] 使用统一错误格式。
- [ ] 列表接口分页。
- [ ] Command 使用幂等 ID。
- [ ] 旧 `/skills/:id/run` 保持兼容。
- [ ] Package Skill 禁止通过旧同步运行接口执行。

## 16. TODO 14：Skills 后台页面

- [ ] 增加 `Installed / Market / Runs` tabs。
- [ ] 增加 GitHub URL 安装入口。
- [ ] 增加安装前 Package 检查页。
- [ ] 展示来源和 commit。
- [ ] 展示 Manifest。
- [ ] 展示不兼容能力。
- [ ] 展示权限差异。
- [ ] 展示当前安装版本。
- [ ] 展示最近 Runs。
- [ ] 展示事件时间线。
- [ ] 展示 Artifacts。
- [ ] 支持撤销权限。
- [ ] 支持禁用和卸载 Skill。
- [ ] Package 更新暂时只提供重新安装固定版本。

## 17. TODO 15：AI 画图页面文章配图模式

- [ ] 增加 `单图生成 / 文章配图` 模式。
- [ ] 支持粘贴正文。
- [ ] 支持 URL。
- [ ] 支持上传 MD、DOCX、PDF、TXT。
- [ ] 支持选择文章配图 Skill。
- [ ] 配置图片数量。
- [ ] 配置比例、风格和模型。
- [ ] 展示具体权限和图片预算。
- [ ] 先生成可编辑插图计划。
- [ ] 支持添加、删除和编辑场景。
- [ ] 用户确认后批量生成。
- [ ] 展示 Run 进度。
- [ ] 图片复用现有 `GenerationCard`。
- [ ] 支持单图重试。
- [ ] 支持导出图片和 Markdown 清单。
- [ ] 支持恢复等待确认或 interrupted 的运行。

## 18. TODO 16：Chat 页面集成

首期只做轻量交接：

- [ ] 检测文章配图意图。
- [ ] 推荐已安装的 image-capable Skill。
- [ ] 展示来源附件或 URL。
- [ ] 提供“打开到 AI 画图”。
- [ ] 将附件、文本和推荐 Skill 带入 Image Studio。
- [ ] Chat 不直接启动批量图片生成。
- [ ] Chat 不展示完整图片结果网格。
- [ ] 可保存一个 Run reference 方便回看。

## 19. TODO 17：旧 Skills 兼容

- [ ] 将现有 Runner 移到 `legacy/`。
- [ ] 旧 Skill 数据表保持可读。
- [ ] 旧 API 保持可用。
- [ ] Legacy Skill 仍可作为普通 Mastra Tool。
- [ ] Package Skill 不再包装成同步 Mastra Tool。
- [ ] UI 清楚标记 `Legacy` 与 `Package`。
- [ ] 新建轻量 Skill 功能暂时保持。
- [ ] 补充 Legacy 和 Package ID 命名空间，避免冲突。

## 20. TODO 18：测试策略

### 20.1 单元测试

- [ ] Manifest 解析。
- [ ] 路径穿越防护。
- [ ] ZIP 安全检查。
- [ ] Capability Policy。
- [ ] Run 状态转换。
- [ ] Event 脱敏。
- [ ] Artifact 路径隔离。
- [ ] 图片预算计算。

### 20.2 集成测试

- [ ] 安装本地 fixture Package。
- [ ] GitHub Archive mock。
- [ ] 启动、暂停、恢复和取消 Run。
- [ ] 应用重启后 interrupted 恢复。
- [ ] 权限拒绝。
- [ ] 图片预算耗尽。
- [ ] 文章配图部分失败。
- [ ] Legacy Skill 回归。

### 20.3 端到端测试

- [ ] 安装文章配图 fixture。
- [ ] 上传 Markdown。
- [ ] 生成插图计划。
- [ ] 用户确认。
- [ ] 模拟生成 6 张图。
- [ ] 单图失败与重试。
- [ ] Artifacts 可下载。
- [ ] Image Studio 可重新打开结果。
- [ ] Skills Runs 页面可追溯全过程。

### 20.4 安全测试

- [ ] ZIP Slip。
- [ ] Symlink escape。
- [ ] 超大压缩包。
- [ ] `../../.env` 引用。
- [ ] 未授权 Python 或 Shell。
- [ ] 直接调用内部工具绕过 Broker。
- [ ] Event 中 API key 脱敏。
- [ ] Artifact ID 越权读取。

## 21. TODO 19：可观测性与运维

- [ ] 为 Skill Run 创建 trace。
- [ ] 关联 Agent step、Tool Run 和 Image Generation。
- [ ] 记录总耗时。
- [ ] 记录等待审批时间。
- [ ] 记录图片调用数。
- [ ] 记录 partial failure 数量。
- [ ] 记录取消次数。
- [ ] 记录 Package 安装失败原因。
- [ ] 设置事件和 Artifact 保留策略。
- [ ] 增加运行目录大小统计与清理。

## 22. 推荐里程碑

| 里程碑 | 包含 TODO | 可交付结果 |
| --- | --- | --- |
| M0 地基 | 00–04 | 迁移、状态机和权限模型可用 |
| M1 Package | 05–07 | 能安全安装和读取目录型 Skill |
| M2 Runtime | 08–11 | Instruction Skill 可持久化运行 |
| M3 Image Slice | 12–13 | 后端文章配图闭环 |
| M4 Product | 14–16 | Skills 后台和 AI 画图操作闭环 |
| M5 Hardening | 17–19 | 兼容、测试、安全和可观测性完成 |

## 23. 实施顺序约束

以下任务必须在文章配图业务实现前完成：

1. 数据库迁移系统。
2. SkillVersion 版本快照。
3. 持久化 Run 状态机。
4. Capability Broker 和集中权限检查。
5. Event 脱敏和 Artifact 隔离。

Python、Shell、自动依赖安装、MCP 和容器继续作为后续独立里程碑，不能混入 B-Lite。

最终实施路径：

```text
M0 安全与持久化地基
  -> M1 安全 Package 安装
  -> M2 Instruction Agent Runtime
  -> M3 文章配图后端闭环
  -> M4 AI 画图与 Skills 后台产品闭环
  -> M5 兼容、测试与加固
```
