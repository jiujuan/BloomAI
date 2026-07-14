# 第三方复杂 Skills 运行时架构设计

> 状态：Draft  
> 日期：2026-07-04  
> 范围：BloomAI skills 系统如何支持第三方目录型、工作流型、脚本型复杂 skills  
> 参考对象：
> - `jimliu/baoyu-skills` 的文章配图类 skills
> - `helloianneo/ian-xiaohei-illustrations` 的多图插画生成 skill
> - `KKKKhazix/khazix-skills/hv-analysis` 的研究分析与报告生成 skill

## 1. 背景

BloomAI 当前已经有 skills 功能，但它的抽象更接近「轻量执行器」：

- `js-function`：在 Node `vm` 中执行一段函数源码。
- `http-api`：把输入插入 URL / body 后发起 HTTP 请求。
- `prompt-template`：把输入插入 prompt 后调用一次模型。

这套模型适合文本总结、翻译、简单数据处理、单次 API 调用，但无法完整表达第三方复杂 skills 的真实结构。

第三方复杂 skills 通常不是一段 prompt，而是一个目录包：

```text
skill-name/
  SKILL.md
  references/
    workflow.md
    style-presets.md
    prompt-construction.md
  assets/
    examples/
  scripts/
    md_to_pdf.py
  templates/
```

它们的运行方式也不是「一次调用返回 JSON」，而是：

- 先读取 `SKILL.md`。
- 根据 `SKILL.md` 指令按需读取 `references/`。
- 解析用户文章、生成计划、等待用户确认。
- 调用 web、文件、图像、Python、shell 等工具。
- 生成多张图片、Markdown、PDF、HTML、prompt 文件等 artifacts。
- 可能持续几分钟到几十分钟，并需要事件流、暂停恢复和运行审计。

因此，如果目标是「读取并成功运行」这些第三方 skills，BloomAI 需要从 `source` 字符串模型升级为 `Skill Package Runtime`。

## 2. 当前实现盘点

当前 skills 相关代码集中在：

- `src/server/skills/types.ts`
- `src/server/skills/run-skill.ts`
- `src/server/skills/registry.ts`
- `src/server/skills/js-function.ts`
- `src/server/skills/http-api.ts`
- `src/server/skills/prompt-template.ts`
- `src/server/http/routes/skills.ts`
- `src/server/db/schema.ts`
- `src/server/db/repositories/skill.repo.ts`
- `src/server/mastra/tools.ts`

关键现状：

1. `SkillRunner` 接口太窄

```ts
export type SkillRunner = (
  source: string,
  input: object,
  context: SkillExecutionContext
) => Promise<object> | object
```

这个接口只有 `source`、`input`、`skillId`，没有 skill 根目录、references、assets、scripts、权限、artifact 输出、事件流、暂停恢复、工作区路径等概念。

2. `skills` 表把 skill 压成一条记录

当前 `skills` 表字段包括：

- `id`
- `name`
- `description`
- `type`
- `source`
- `params_schema`
- `author`
- `version`
- `is_public`
- `is_installed`
- `install_count`
- `created_at`

缺失：

- 安装来源 URL
- commit hash / tag / version lock
- 本地包路径
- manifest hash
- references / assets / scripts 索引
- 权限声明
- 依赖声明
- artifact 记录
- 运行事件
- 暂停恢复状态

3. `js-function` runner 是强限制沙箱

`js-function` 跑在 `vm.runInNewContext` 中：

- 无 `require`
- 无 `process`
- 无 `fs`
- 无 node module dependency
- 5 秒超时

这对简单 JS 函数是好的，但无法运行目录型 skill 的脚本、依赖和文件产物流程。

4. `prompt-template` 是单轮模型调用

`prompt-template` 目前固定调用 Anthropic messages API，模型固定，无法：

- 读取 skill 包内 references
- 调用工具
- 分步执行
- 生成过程事件
- 多轮确认
- 输出多个 artifacts

5. Mastra 侧只是把 skill 包成一个普通 tool

`src/server/mastra/tools.ts` 会把已安装 skill 挂成 `skill_<id>` tool，执行时调用 `runSkill()`。

这说明 BloomAI 已经有一个可复用入口，但当前输出只是 `record`，没有把复杂 skill 的过程和产物建模出来。

## 3. 第三方 Skills 的能力需求

### 3.1 文章生成图片类

以 `baoyu-article-illustrator` 为代表，这类 skill 通常需要：

- 输入一篇文章或 URL。
- 分析文章主题、结构和关键场景。
- 生成多张配图方案。
- 让用户选择风格、数量、尺寸。
- 构造高质量图像 prompt。
- 批量调用 image generation。
- 保存 prompt 文件和图片文件。
- 输出一个图片清单或插图包。

需要的系统能力：

- 读文章 / 抓网页。
- 读 `references/workflow.md`、风格预设、prompt 构造规则。
- 调用 `image_gen`。
- 写入 artifacts。
- 长任务进度事件。
- 可重试单张失败图片。

### 3.2 多图插画类

以 `ian-xiaohei-illustrations` 为代表，这类 skill 通常需要：

- 从文章中抽取多个可视化场景。
- 生成 shot list。
- 读取 examples / style references。
- 按统一角色、构图、风格生成多张图片。
- 输出到指定目录，例如 `assets/-illustrations/`。

需要的系统能力：

- Skill 包内 assets 访问。
- 多次 image job 编排。
- 统一视觉设定在多次工具调用之间传递。
- 产物路径管理。

### 3.3 研究分析类

以 `hv-analysis` 为代表，这类 skill 通常需要：

- 深度联网研究。
- 并行子任务或子 Agent。
- 长文写作。
- 生成 Markdown 报告。
- 运行 Python 脚本把 Markdown 转 PDF。
- 保存最终报告与中间资料。

需要的系统能力：

- web search / fetch / extract。
- document parsing。
- long-running agent workflow。
- Python runtime。
- 依赖安装或隔离环境。
- Markdown / PDF artifacts。
- 高权限操作显式确认。

## 4. 设计目标

1. 支持目录型 skill 包

BloomAI 应能安装 GitHub repo、repo 子目录、本地 zip、本地 folder，并识别其中的 `SKILL.md`、`references/`、`assets/`、`scripts/`。

2. 保持安全边界

第三方 skill 是不可信输入。它不能直接访问文件系统、shell、API key 或网络，必须通过 BloomAI 的工具网关和权限系统。

3. 复用现有工具系统

所有 skill 的能力调用都应经过 `executeTool()`，复用已有：

- tool registry
- permission gate
- tool_runs 审计
- timeout
- session trace

4. 支持长任务

复杂 skill 需要事件流，而不是一次性返回：

- run started
- instruction loaded
- reference loaded
- step started
- tool call started
- artifact created
- approval required
- run completed / failed

5. artifacts 一等化

图片、Markdown、PDF、HTML、prompt、JSON 都应该作为 `SkillArtifact` 管理，而不是塞进一个 JSON output。

6. 渐进兼容

保留现有 `js-function`、`http-api`、`prompt-template`，但新增 package runtime。旧 skill 不必迁移。

## 5. 推荐目标架构

```text
Renderer
  Skills Page
  Skill Run Timeline
  Artifact Gallery
      |
      v
HTTP API
  /api/v1/skills
  /api/v1/skills/install
  /api/v1/skills/:id/run
  /api/v1/skill-runs/:runId/events
  /api/v1/skill-runs/:runId/artifacts
      |
      v
Skill Domain
  SkillPackageStore
  SkillManifestResolver
  SkillInstructionLoader
  SkillRuntime
  SkillToolGateway
  SkillPermissionPolicy
  SkillArtifactStore
      |
      v
Existing Capabilities
  executeTool()
  Mastra Agent
  LLM Registry
  Image Generation
  Web Tools
  File Tools
  Python / Shell Tools
  SQLite
```

### 5.1 SkillPackageStore

职责：

- 从 GitHub URL、本地 folder、本地 zip 安装 skill。
- 保存到本地 app data 目录。
- 记录安装来源、commit hash、版本、manifest hash。
- 支持卸载、更新、回滚。

建议本地路径：

```text
<appData>/skills/packages/{publisher}/{skillName}/{version}/
```

对于 GitHub repo：

```text
github.com/jimliu/baoyu-skills
  skills/baoyu-article-illustrator/SKILL.md
```

需要支持从 repo 中发现多个 skill。

### 5.2 SkillManifestResolver

职责：

- 兼容多种第三方格式。
- 将不同来源统一归一为 BloomAI manifest。

输入格式：

- `SKILL.md` frontmatter
- `.bloom-skill/manifest.json`
- `.claude-plugin/plugin.json`
- 仓库约定目录，例如 `skills/*/SKILL.md`

归一化输出：

```ts
type SkillManifest = {
  id: string
  name: string
  version: string
  description: string
  entry: string
  runtime: 'instruction-agent' | 'script' | 'workflow' | 'mcp-plugin'
  triggers: string[]
  files: {
    skillMd: string
    references: string[]
    assets: string[]
    scripts: string[]
  }
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  permissions: SkillPermission[]
  dependencies?: SkillDependency[]
}
```

### 5.3 SkillInstructionLoader

职责：

- 完整读取入口 `SKILL.md`。
- 按 progressive disclosure 加载 references。
- 解析相对路径，所有相对路径都以 skill 根目录为准。
- 防止路径逃逸，例如 `../../.env`。

规则：

1. 运行开始时读取 `SKILL.md`。
2. 只有当 `SKILL.md` 明确要求读取某个 `references/*.md`、`assets/*`、`scripts/*` 时才加载。
3. 加载前校验路径必须在 skill package 根目录内。
4. 加载内容进入 run trace，便于复现。

### 5.4 SkillRuntime

职责：

- 作为新 skills 系统的执行核心。
- 将复杂 skill 作为一个可观察、可暂停、可恢复的 workflow 执行。

建议接口：

```ts
type RunSkillPackageInput = {
  skillId: string
  input: object
  sessionId?: string
  userId?: string
}

type SkillRuntime = {
  run(input: RunSkillPackageInput): AsyncIterable<SkillRunEvent>
  resume(runId: string, input: object): AsyncIterable<SkillRunEvent>
  cancel(runId: string): Promise<void>
}
```

事件协议：

```ts
type SkillRunEvent =
  | { type: 'run_started'; runId: string; skillId: string }
  | { type: 'instruction_loaded'; path: string }
  | { type: 'reference_loaded'; path: string }
  | { type: 'step_started'; title: string }
  | { type: 'step_completed'; title: string }
  | { type: 'tool_call_started'; toolCallId: string; toolId: string; input: object }
  | { type: 'tool_call_completed'; toolCallId: string; output: object }
  | { type: 'artifact_created'; artifactId: string; kind: string; path: string }
  | { type: 'approval_required'; approvalId: string; reason: string; permissions: string[] }
  | { type: 'run_completed'; output: object }
  | { type: 'run_failed'; error: string }
```

### 5.5 SkillToolGateway

职责：

- 复杂 skill 不直接调用系统能力。
- 所有工具调用都通过 gateway 转到 `executeTool()`。

```ts
type SkillToolGateway = {
  callTool(runId: string, toolId: string, input: object): Promise<object>
}
```

允许映射的工具：

- `web_search`
- `web_fetch`
- `web_extract`
- `doc_markdown`
- `doc_pdf`
- `doc_docx`
- `fs_read`
- `fs_write`
- `image_gen`
- `image_edit`
- `vision`
- `ocr`
- `python_runner`
- `shell`

原则：

- 自动允许低风险只读工具。
- 写入、shell、Python、依赖安装必须显式授权。
- 工具调用必须记录到 `tool_runs` 和 `skill_run_events`。

### 5.6 SkillPermissionPolicy

权限声明示例：

```ts
type SkillPermission =
  | 'network'
  | 'web_search'
  | 'image_generation'
  | 'read_workspace'
  | 'write_workspace'
  | 'write_artifacts'
  | 'run_python'
  | 'run_shell'
  | 'install_dependencies'
  | 'spawn_subagents'
  | 'read_home_config'
```

安装时展示权限声明；运行时遇到危险能力再次确认。

推荐分级：

| 权限 | 默认行为 | 说明 |
| --- | --- | --- |
| `web_search` | 可自动允许 | 查询公开网络信息 |
| `network` | 可自动允许或按设置 | 抓网页/API |
| `image_generation` | 可自动允许但提示成本 | 会消耗模型额度 |
| `read_workspace` | 需要确认目录范围 | 读取用户文件 |
| `write_artifacts` | 可允许到 artifacts 目录 | 安全输出目录 |
| `write_workspace` | 需要确认 | 修改项目文件 |
| `run_python` | 需要确认 | 执行代码 |
| `run_shell` | 需要强确认 | 高风险 |
| `install_dependencies` | 需要强确认 | 会改变环境 |
| `read_home_config` | 默认拒绝 | 可能泄露密钥 |

### 5.7 SkillArtifactStore

复杂 skill 的主要价值往往是产物，因此 artifact 必须独立建模。

```ts
type SkillArtifact = {
  id: string
  runId: string
  skillId: string
  kind: 'markdown' | 'image' | 'pdf' | 'html' | 'prompt' | 'json' | 'directory'
  title?: string
  path: string
  mimeType?: string
  metadata?: object
  createdAt: number
}
```

建议存储路径：

```text
<appData>/skills/runs/{runId}/artifacts/
  report.md
  report.pdf
  prompts/
  images/
```

对于文章配图类 skill：

- 每张图片一个 artifact。
- 每个 prompt 文件一个 artifact。
- 最终图片清单一个 JSON/Markdown artifact。

对于研究报告类 skill：

- 原始资料摘要一个 Markdown artifact。
- 最终报告一个 Markdown artifact。
- PDF 一个 PDF artifact。

## 6. 数据模型建议

保留现有 `skills` / `skill_runs`，但建议扩展或新增以下表。

### 6.1 `skill_packages`

```sql
CREATE TABLE skill_packages (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_ref TEXT,
  source_commit TEXT,
  package_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 6.2 扩展 `skills`

新增字段：

- `package_id`
- `entry_path`
- `runtime`
- `permissions_json`
- `dependencies_json`
- `manifest_json`
- `manifest_hash`

旧 `source` 字段继续供 `js-function`、`http-api`、`prompt-template` 使用。

### 6.3 `skill_run_events`

```sql
CREATE TABLE skill_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

### 6.4 `skill_artifacts`

```sql
CREATE TABLE skill_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  path TEXT NOT NULL,
  mime_type TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
```

### 6.5 `skill_permissions`

```sql
CREATE TABLE skill_permissions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  scope_json TEXT,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at INTEGER
);
```

## 7. HTTP API 建议

### 7.1 安装

```text
POST /api/v1/skills/install
```

输入：

```json
{
  "source": "https://github.com/jimliu/baoyu-skills",
  "ref": "main",
  "path": "skills/baoyu-article-illustrator"
}
```

输出：

```json
{
  "data": {
    "packageId": "pkg_xxx",
    "skills": [
      {
        "id": "baoyu-article-illustrator",
        "name": "Article Illustrator",
        "runtime": "instruction-agent",
        "permissions": ["network", "image_generation", "write_artifacts"]
      }
    ]
  }
}
```

### 7.2 运行

```text
POST /api/v1/skills/:id/run
```

输入：

```json
{
  "input": {
    "article": "...",
    "imageCount": 6,
    "style": "editorial"
  },
  "sessionId": "optional"
}
```

输出：

```json
{
  "data": {
    "runId": "run_xxx",
    "status": "running"
  }
}
```

事件流：

```text
GET /api/v1/skill-runs/:runId/events
```

Artifacts：

```text
GET /api/v1/skill-runs/:runId/artifacts
```

恢复：

```text
POST /api/v1/skill-runs/:runId/resume
```

取消：

```text
POST /api/v1/skill-runs/:runId/cancel
```

## 8. 实现方案对比

### 方案 A：最小兼容层，`SKILL.md` 解释执行

#### 做法

新增一种 skill 类型：`package-instruction`。

安装 GitHub / 本地目录后，保存文件路径。运行时：

1. 读取 `SKILL.md`。
2. 按需读取 `references/`。
3. 把指令交给 Mastra Agent。
4. Agent 通过现有 tools 完成任务。
5. 输出最终 JSON 或 Markdown。

#### 优点

- 实现最快。
- 对文章配图、多图插画类 skill 有较高覆盖。
- 复用现有 Mastra tools 和 `image_gen`。
- 不需要马上做容器、依赖安装、插件进程。

#### 缺点

- 长任务过程和 artifacts 如果不额外补，会不可观察。
- 对 Python 脚本、PDF 生成、复杂依赖支持弱。
- LLM 对复杂 workflow 的执行稳定性有限。
- 安全依赖工具权限，但 package 文件本身的能力声明仍不完整。

#### 适用场景

- 首阶段验证第三方 skill 兼容性。
- 快速跑通 `baoyu`、`ian-xiaohei-illustrations` 中的纯指令和图像生成流程。

### 方案 B：原生 Skill Package Runtime

#### 做法

正式引入：

- `SkillPackageStore`
- `SkillManifestResolver`
- `SkillInstructionLoader`
- `SkillRuntime`
- `SkillToolGateway`
- `SkillPermissionPolicy`
- `SkillArtifactStore`

第三方 skill 作为目录包安装，运行时由 BloomAI runtime 管理事件、权限、工具、产物和恢复。

#### 优点

- 覆盖范围广，能承载配图、研究、报告生成等复杂 workflows。
- 安全边界清晰。
- artifacts、事件流、运行审计完整。
- 与现有 tools、Image Studio、Mastra、SQLite 可以自然整合。
- 适合未来 Skill Market、版本更新和复现能力。

#### 缺点

- 改动较大。
- 需要新增数据表、HTTP API、前端运行 UI。
- 需要认真设计事件协议、权限协议和 artifact 协议。
- Python / shell 依赖仍需要后续子系统支持。

#### 适用场景

- BloomAI 的主线架构。
- 真正想支持第三方 skills 生态，而不只是「参考 prompt」。

### 方案 C：插件进程 / MCP / 容器运行时

#### 做法

每个复杂 skill 或 skill bundle 在独立进程、MCP server 或容器中运行。BloomAI 通过协议调用它们。

#### 优点

- 隔离最强。
- 支持复杂 Python / Node / 系统依赖。
- BloomAI 主进程不会被第三方依赖污染。
- 适合 `hv-analysis` 这类重型研究分析与 PDF 生成流程。

#### 缺点

- 桌面端分发复杂。
- Windows/macOS/Linux 差异大。
- 容器对普通用户门槛高。
- 权限、文件映射、日志、调试都更复杂。
- 首期成本最高。

#### 适用场景

- 第二或第三阶段。
- 高风险、高依赖、长时间运行的专业 skill。

### 方案 D：纯 Agent + 市场索引，不执行脚本

#### 做法

只把第三方 skill 当成 prompt、规则和参考文档。BloomAI 不运行其 scripts，不安装依赖，只让 Agent 使用现有 tools 模拟执行流程。

#### 优点

- 实现简单。
- 风险低。
- 适合纯写作、纯提示词、轻量分析 skill。

#### 缺点

- 不能称为「成功运行」复杂 skill。
- 对脚本、PDF、批量文件产物支持不足。
- 用户对第三方 skill 的预期会落空。

#### 适用场景

- 临时兜底。
- 安全模式。
- 对未知第三方仓库先做只读预览。

## 9. 推荐路线

推荐采用：

```text
B 为主线，A 先落地，C 预留接口，D 作为安全兜底。
```

### 第一阶段：Package Instruction Runner

目标：

- 支持 GitHub URL / 本地目录安装。
- 支持发现 `SKILL.md`。
- 支持读取 `references/`。
- 支持将 skill 作为 Mastra tool / workflow 执行。
- 支持调用 `image_gen`、web tools、doc tools。
- 支持基础 artifact 输出目录。

可验证目标：

- 能跑通文章配图类 skill 的基本流程。
- 能跑通多图插画 skill 的基本流程。
- 能生成多张图片并保存到 artifacts。

### 第二阶段：运行事件和 Artifacts

目标：

- 新增 `skill_run_events`。
- 新增 `skill_artifacts`。
- 前端 Skills 页面展示运行 timeline。
- 支持长任务进度。
- 支持用户确认和 resume。
- 支持取消运行。

可验证目标：

- 用户能看到每一步读取了什么、调用了什么工具、生成了什么文件。
- 图片生成失败时可以定位到具体 tool call。

### 第三阶段：脚本运行和依赖隔离

目标：

- 支持受限 Python venv。
- 支持按 skill 声明安装 Python 依赖。
- 支持脚本 artifact 输出。
- 支持强权限确认。
- 对 shell 保持默认禁用。

可验证目标：

- `hv-analysis` 类 skill 能生成 Markdown 和 PDF。
- 依赖安装和脚本执行都能审计。

### 第四阶段：Skill Market 和版本管理

目标：

- 支持 skill 搜索、安装、更新、卸载。
- 安装时显示权限变更。
- 支持 commit pin。
- 支持 manifest diff。
- 支持运行兼容性检查。

可验证目标：

- 用户能安全安装第三方 repo。
- 更新 skill 前能看到它新增了什么权限。

## 10. 与现有系统的关系

### 10.1 与 Tools 的关系

Skills 不应该绕过 tools。

所有外部能力都应经过：

```text
SkillRuntime -> SkillToolGateway -> executeTool() -> toolRegistry
```

这样可以复用已有：

- permission gate
- tool_runs
- timeout
- executor registry
- sessionId 关联

### 10.2 与 Mastra Agent 的关系

Mastra 适合承载 `instruction-agent` runtime：

- 理解 `SKILL.md`
- 编排工具调用
- 处理自然语言任务
- 生成中间推理和最终结果

但 BloomAI 不应把 skill runtime 完全交给 Mastra。BloomAI 应保留：

- package 安装
- 文件加载规则
- 权限决策
- 工具网关
- artifact 存储
- run events
- resume/cancel

### 10.3 与 Image Studio 的关系

文章配图类 skill 和 Image Studio 应共享图像生成底座：

- `image_gen` tool
- `generateImage()`
- 图片 provider registry
- 本地图片保存
- image artifact 展示

未来可以增加一种 image model source：

```text
image provider = skill
```

这样某个图像 skill 可以作为 Image Studio 的模型/模板来源。

### 10.4 与 Chat 的关系

Chat 不应默认暴露所有 skill 全量内容给模型。推荐：

1. Skill registry 只暴露简短描述和 input schema。
2. 当模型选择某个 skill 后，SkillRuntime 再加载完整 `SKILL.md`。
3. 运行过程通过 chat timeline 展示。

避免：

- 每轮把所有已安装 skills 的全文塞进上下文。
- 让模型绕过 runtime 直接读写 skill 目录。

## 11. 安全边界

第三方 skill 必须按不可信代码/不可信指令处理。

### 11.1 安装前

- 显示来源 URL。
- 显示 commit hash。
- 显示 skill 文件列表。
- 显示权限声明。
- 标记未知脚本和依赖。

### 11.2 运行前

- 对危险权限二次确认。
- 默认 artifact 写入隔离目录。
- 默认禁止读取 `.env`、home config、SSH key、API key。
- 默认禁止 shell。

### 11.3 运行中

- 每次工具调用写事件。
- 文件路径必须检查是否在允许范围内。
- 网络请求可按域名策略限制。
- 图片生成提示成本。

### 11.4 运行后

- 保留 run trace。
- 保留 artifacts。
- 用户可删除 artifacts。
- 用户可撤销 skill 权限。

## 12. 验收清单

### Package 安装

- [ ] 能从 GitHub repo 安装指定子目录 skill。
- [ ] 能从本地目录安装 skill。
- [ ] 能识别 `SKILL.md`。
- [ ] 能发现 `references/`、`assets/`、`scripts/`。
- [ ] 能记录来源 URL 和 commit hash。

### Instruction Runtime

- [ ] 能完整读取 `SKILL.md`。
- [ ] 能按需读取 references。
- [ ] 能阻止路径逃逸。
- [ ] 能调用 web 和 image tools。
- [ ] 能输出 artifacts。

### 文章配图类

- [ ] 输入文章后生成插图计划。
- [ ] 能生成多张图片。
- [ ] 能保存 prompt 和图片 artifacts。
- [ ] 单张失败不导致全流程不可诊断。

### 研究分析类

- [ ] 能联网研究。
- [ ] 能生成 Markdown 报告。
- [ ] 能运行受限 Python 脚本。
- [ ] 能生成 PDF artifact。

### 权限与审计

- [ ] 安装时展示权限。
- [ ] 高风险工具运行前确认。
- [ ] 每个 tool call 有 run event。
- [ ] 每个 artifact 可追溯到 runId。

## 13. 关键结论

BloomAI 当前 skills 系统的核心抽象是 `source + runner`，适合轻量技能，但不足以支撑复杂第三方 skills。

复杂第三方 skill 的真实单位是：

```text
目录包 + manifest + references + assets + scripts + permissions + runtime events + artifacts
```

因此推荐将 skills 系统升级为 `Skill Package Runtime`：

- 旧的 `js-function` / `http-api` / `prompt-template` 继续保留。
- 新增 package runtime 支持目录型 skill。
- 工具调用统一走 `executeTool()`。
- artifacts 和 run events 成为一等能力。
- 重依赖脚本型 skill 后续进入插件进程或隔离 runtime。

这条路线能先快速兼容文章配图和多图插画类 skills，同时为 `hv-analysis` 这类重型研究分析 skill 留出可控、安全、可审计的演进路径。
