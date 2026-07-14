# Skill Package Runtime 前端操作与产品集成方案

> 状态：Draft  
> 日期：2026-07-04  
> 范围：升级为 Skill Package Runtime 后，用户如何在 Skills、Chat、AI 画图页面发现、配置、运行和复用复杂 skills  
> 关联文档：[third-party-skills-runtime-architecture.md](./third-party-skills-runtime-architecture.md)

## 1. 问题定义

上一份架构文档解决的是「BloomAI 后端如何安装、读取、授权和运行第三方复杂 skill」。这份文档解决前端产品问题：

- 用户在哪里找到并启动一个 skill？
- 用户如何上传文章、粘贴正文、输入 URL，调用「文章配图」类 skill？
- Skill 运行过程中，用户如何理解当前进度、确认高成本/高风险步骤、处理失败？
- 生成出来的图片、prompt、Markdown、PDF 等产物在哪里管理？
- Chat 页面和 AI 画图页面如何共享同一个 Skill Package Runtime，而不是各做一套？

核心目标不是把 skills 做成一个孤立页面，而是让 skills 成为 BloomAI 各工作场景里的可调用能力。

## 2. 当前前端基础

### 2.1 Skills 页面

当前 `src/renderer/pages/Skills/index.tsx` 是一个市场/已安装卡片网格：

- 顶部搜索。
- `Installed` 区域。
- `Market Recommendations` 区域。
- 支持创建轻量 skill。

现状问题：

- 没有 skill 详情页。
- 没有 package 安装向导。
- 没有权限说明。
- 没有运行入口和运行历史。
- 没有 artifacts 展示。

### 2.2 Chat 页面

当前 `ChatPanelMastra` 已有：

- 文本输入。
- 文件附件上传。
- 模式选择：对话 / 计划 / 深度思考。
- Agent tab：研究 / AI 写作 / 编码。
- ToolGroupCard。
- ApprovalCard。
- WorkflowSteps。
- `message.parts` 持久化。

这说明 Chat 已经适合承载 skill run 的自然语言入口和过程时间线。

### 2.3 AI 画图页面

当前 `ImageStudioPage` 是三栏：

```text
ImageSessionList | ImageChatPanel + ImageComposer | TemplateGallery
```

已有能力：

- 图像会话。
- 图像 prompt 输入。
- 模型 / 比例 / 风格 / 参考图 / 智能优化。
- 模板「做同款」。
- 生成结果卡。
- 下载、复制、查看大图、重绘、设为参考图。

这说明 AI 画图页面适合承载「文章配图」类 skill 的主要工作流。

## 3. 用户心智

用户不会关心 runtime 类型、manifest、tool gateway。他们关心的是：

1. 我有一篇文章。
2. 我想给它配图。
3. 我想选择风格、数量、比例、是否统一人物/品牌视觉。
4. 我希望系统先给我一个插图计划。
5. 我确认后批量生成图片。
6. 我能查看、替换、重绘、下载、导出整套配图。

因此前端不应该让用户先理解「skill 包」再开始工作，而应该提供场景化入口：

- 在 Chat 里说：「帮我给这篇文章配图」。
- 在 AI 画图页选择：「文章配图」技能。
- 在 Skills 页打开某个已安装 skill，点击「运行」。

三种入口应该进入同一个 `SkillRunSurface`，只是嵌入位置不同。

## 4. 设计原则

1. 场景优先

对普通用户，入口文案是「给文章配图」「生成小黑插画」「生成研究报告」，而不是 `Run Skill`。

2. 运行过程可见

复杂 skill 可能持续数分钟。用户必须看到当前阶段：

- 正在读取文章
- 正在拆分场景
- 等待确认插图计划
- 正在生成第 1/6 张图
- 正在保存文件
- 已完成，可下载

3. 产物优先

运行结果不只是最终文本。图片、prompt、Markdown、PDF 要以产物方式展示，且可以复用到 Image Studio 或 Chat。

4. 权限不打断低风险流程，但必须拦截高风险操作

文章配图类 skill 通常需要网络、图片生成、写 artifacts。运行前一次说明即可。Python、shell、写工作区、安装依赖必须运行中确认。

5. 同一个 runtime，多处嵌入

Chat、Image Studio、Skills 页不各自实现 skill 运行逻辑。前端共享：

- `SkillPicker`
- `SkillInputPanel`
- `SkillRunTimeline`
- `SkillArtifactStrip`
- `SkillPermissionDialog`
- `SkillRunDrawer`

## 5. 推荐产品架构

推荐采用「统一 Skill Run Surface + 多入口嵌入」：

```text
Skills Page
  ├─ 安装 / 管理 / 运行历史
  └─ 打开 SkillRunDrawer

Chat Page
  ├─ 用户自然语言触发
  ├─ SkillSuggestionCard
  └─ 消息流内嵌 SkillRunCard

AI Image Studio
  ├─ Skill mode in composer
  ├─ Article input drawer
  ├─ Illustration plan review
  └─ Image artifacts become generation cards

Shared UI
  ├─ SkillPicker
  ├─ SkillRunConfigForm
  ├─ SkillRunTimeline
  ├─ SkillArtifactGrid
  ├─ SkillApprovalCard
  └─ SkillRunSummary
```

## 6. 核心操作流程

### 6.1 从 AI 画图页运行「文章配图」skill

这是文章配图类 skill 的主流程。

#### Step 1：进入 AI 画图页

右侧 `TemplateGallery` 扩展为两段：

```text
模板
Skills
```

`Skills` 区域只显示 image-capable skills：

- 文章配图
- 小黑插画
- 公众号封面组图
- 分镜图生成

每个 skill 以紧凑条目展示：

```text
[图标] 文章配图
      根据长文生成插图计划并批量出图
      需要：图片生成 · 写入产物
      [运行]
```

#### Step 2：点击运行

点击后，中间面板底部的 `ImageComposer` 切换为 `Skill Mode`，或打开右侧抽屉。

推荐使用抽屉而不是弹窗，因为用户需要持续看见图像会话上下文。

抽屉结构：

```text
文章配图
根据文章内容生成插图计划和图片

输入
  [粘贴正文 / 输入 URL / 上传文件]

输出设置
  图片数量     [ 6 ]
  比例         [ 4:3 v ]
  风格         [ 编辑插画 v ]
  模型         [ Agnes Image v ]
  统一视觉     [on]
  保存 prompt  [on]

权限
  图片生成 · 写入产物

[生成插图计划]
```

输入区支持三种来源：

- 粘贴正文：大文本框。
- 输入 URL：系统调用 `web_fetch` 读取。
- 上传文件：支持 MD/DOCX/PDF/TXT，复用 Chat attachments 上传链路。

#### Step 3：生成插图计划

用户点「生成插图计划」后，runtime 不立即出图，而是先分析文章并生成 plan。

中间流里出现 `IllustrationPlanCard`：

```text
插图计划 · 6 张

1. 开篇主视觉：表现文章核心冲突
   建议位置：标题后
   构图：横向，人物在左，信息流在右

2. 关键概念解释图：...

...

[修改数量] [重新规划] [开始生成]
```

为什么需要 plan gate：

- 批量出图有成本。
- 用户常常想调整数量和风格。
- 文章配图质量主要取决于前期场景拆分。

#### Step 4：开始批量生成

用户确认后，`SkillRunTimeline` 显示进度：

```text
文章配图正在运行
✓ 读取文章
✓ 生成插图计划
● 生成图片 2/6
  - 第 1 张完成
  - 第 2 张生成中
○ 保存产物
```

同时 `ImageChatPanel` 逐个插入 generation placeholders：

- 第 1 张 skeleton。
- 第 1 张完成后替换为 `GenerationCard`。
- 第 2 张继续 skeleton。

每张图片作为普通 Image Studio 产物展示，用户可以：

- 下载。
- 复制。
- 查看大图。
- 重绘。
- 做同款。
- 设为参考图。

#### Step 5：完成后产物汇总

批量完成后出现 `SkillRunSummary`：

```text
文章配图完成
生成 6 张图片 · 6 个 prompt · 1 份插图清单

[打开产物目录] [导出 Markdown 清单] [复制全部 prompt] [继续生成 3 张]
```

同时右侧 `Skills` 区域或当前会话顶部显示本次运行记录。

### 6.2 从 Chat 页面自然语言触发

Chat 入口适合用户不明确知道该用哪个 skill 的场景。

#### 用户操作

用户可以：

- 上传一篇文章文件。
- 在输入框粘贴文章。
- 输入 URL。
- 直接说：「给这篇文章配 6 张图，适合公众号」。

#### 系统行为

Chat agent 做轻量 intent detection：

```text
用户意图：文章配图
候选 skill：baoyu-article-illustrator / ian-xiaohei-illustrations
```

不要让模型自行运行所有工具。先展示 `SkillSuggestionCard`：

```text
检测到这是文章配图任务

推荐使用：
[文章配图] 适合公众号/博客长文
[小黑插画] 适合黑白幽默插图风格

输入来源：已上传 article.docx
输出位置：AI 画图 / 当前会话

[使用文章配图] [换一个 skill] [普通回答]
```

用户点击后，Chat 消息流中出现 `SkillRunCard`。

#### Chat 内运行态

Chat 内不展示完整图片工作台，只展示过程和摘要：

```text
文章配图
正在生成插图计划...

✓ 读取 article.docx
✓ 生成 6 个场景
等待确认

[查看计划] [开始生成] [打开到 AI 画图]
```

推荐在 Chat 中提供「打开到 AI 画图」按钮。点击后：

- 创建或切换到一个 Image Studio session。
- 把 article、skillId、runId、plan 带过去。
- AI 画图页继续运行或展示结果。

原则：

- Chat 可以启动 skill。
- 图像密集的 review / 重绘 / 导出放在 AI 画图页。

### 6.3 从 Skills 页面运行

Skills 页面负责安装、权限、详情和历史，不是主要创作工作台。

#### 页面结构升级

建议从卡片网格升级为三栏或双栏：

```text
左：Installed / Market / Runs
中：Skill list
右：Skill detail
```

如果保持当前网格，也应增加详情抽屉。

Skill 详情包含：

- 名称、描述、作者、版本、来源。
- 适用场景。
- 输入类型。
- 输出产物类型。
- 权限声明。
- 最近运行。
- 操作按钮。

操作按钮：

```text
[运行] [在 Chat 中使用] [在 AI 画图中使用] [卸载]
```

对于 image-capable skill：

- 默认按钮是「在 AI 画图中使用」。

对于 research/report skill：

- 默认按钮是「运行」或「在 Chat 中使用」。

#### 运行入口

点击「运行」打开 `SkillRunDrawer`：

```text
运行：文章配图

输入
  文章正文 / URL / 文件

参数
  图片数量
  风格
  比例
  模型

输出到
  [AI 画图新会话 v]

[开始]
```

这适合高级用户和调试。

## 7. UI 组件设计

### 7.1 `SkillPicker`

用途：

- Chat composer skill 菜单。
- Image Studio 右侧 skill 列表。
- Skills 页运行抽屉。

显示字段：

- skill 名称。
- 短描述。
- 能力标签：`image`、`article`、`research`、`pdf`。
- 权限摘要。
- 安装状态。

交互：

- 搜索。
- 按能力筛选。
- 最近使用优先。
- 未安装 skill 显示「安装」。

### 7.2 `SkillRunConfigForm`

由 manifest/input schema 驱动，但需要产品化控件映射：

| schema 字段 | UI 控件 |
| --- | --- |
| `articleText` | 大文本框 |
| `articleUrl` | URL 输入 |
| `articleFile` | 文件上传 |
| `imageCount` | stepper |
| `aspectRatio` | ratio segmented / menu |
| `style` | style menu |
| `model` | model picker |
| `savePrompts` | toggle |
| `unifiedVisual` | toggle |

不要直接渲染原始 JSON schema 表单。要做字段类型到专业控件的映射。

### 7.3 `SkillRunTimeline`

用于 Chat、Image Studio、Skills 详情。

展示层级：

```text
Run title
Current status
Step list
Tool calls collapsed
Approvals
Artifacts
```

状态：

- `queued`
- `running`
- `waiting_approval`
- `completed`
- `failed`
- `cancelled`

### 7.4 `IllustrationPlanCard`

文章配图专用计划卡。

字段：

- 场景标题。
- 建议位置。
- 画面描述。
- 风格提示。
- 状态：待生成 / 生成中 / 完成 / 失败。

操作：

- 编辑单个场景。
- 删除场景。
- 增加场景。
- 重新规划。
- 开始生成。

### 7.5 `SkillArtifactGrid`

展示 artifacts：

- 图片缩略图。
- prompt 文件。
- Markdown 清单。
- PDF。
- JSON 数据。

图片 artifact 在 Image Studio 中应该直接复用 `GenerationCard`，不要再做一套图片卡。

### 7.6 `SkillApprovalCard`

复用现有 `ApprovalCard` 交互，但内容更具体：

```text
文章配图 想执行图片生成
预计生成：6 张
模型：Agnes Image
可能消耗：6 次图片生成额度

[允许本次] [拒绝]
```

高风险示例：

```text
hv-analysis 想运行 Python 脚本
脚本：scripts/md_to_pdf.py
输出：report.pdf

[查看脚本] [允许本次] [拒绝]
```

## 8. 信息架构

### 8.1 Skills 页面

推荐结构：

```text
Skills
  Search
  Tabs: Installed | Market | Runs

Installed
  SkillCard / SkillRow
  Detail Drawer

Market
  GitHub install
  Recommended packages

Runs
  Recent skill runs
  Filter by status / skill / surface
```

Skill detail drawer：

```text
Header
  名称 / 作者 / 版本 / 来源

Use
  Primary action
  Secondary actions

Capabilities
  输入类型 / 输出类型 / 适用页面

Permissions
  权限列表 / 已授权状态

Runs
  最近运行
```

### 8.2 Chat 页面

新增位置：

1. Composer 左侧新增 `Skills` chip。

```text
[+] [对话] [模型] [Agent tabs] [Skills]
```

2. 消息流新增 skill parts：

- `data-skill-suggestion`
- `data-skill-run`
- `data-skill-artifacts`

3. 运行中使用 `SkillRunCard`，完成后折叠为 summary。

### 8.3 AI 画图页面

新增位置：

1. 右侧面板增加 `Skills` tab。

```text
右栏 tabs: 模板 | Skills | 产物
```

2. Composer 增加模式 chip：

```text
[图像生成 v]
```

菜单：

- 图像生成
- 文章配图
- 批量变体
- 参考图重绘

3. 中间流新增 skill run group：

```text
SkillRunGroup
  Plan
  Progress
  Generated images
  Summary
```

## 9. 前端状态模型

建议新增独立 store：

```ts
type SkillRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

type SkillRunSurface = 'skills' | 'chat' | 'image'

type SkillRunSummary = {
  id: string
  skillId: string
  title: string
  status: SkillRunStatus
  surface: SkillRunSurface
  sessionId?: string
  imageSessionId?: string
  createdAt: number
  updatedAt: number
}

type SkillArtifact = {
  id: string
  runId: string
  kind: 'image' | 'markdown' | 'pdf' | 'prompt' | 'json' | 'directory'
  title?: string
  url?: string
  localPath?: string
  metadata?: Record<string, unknown>
}

type SkillRunEvent = {
  id: string
  runId: string
  seq: number
  type: string
  payload: Record<string, unknown>
  createdAt: number
}
```

Zustand store：

```ts
interface SkillRuntimeState {
  installed: SkillSummary[]
  market: SkillSummary[]
  runsById: Record<string, SkillRunSummary>
  eventsByRun: Record<string, SkillRunEvent[]>
  artifactsByRun: Record<string, SkillArtifact[]>
  activeRunId: string | null
}
```

Actions：

- `installPackage(input)`
- `loadInstalled()`
- `loadRuns(filter)`
- `startRun(input)`
- `subscribeRun(runId)`
- `resumeRun(runId, input)`
- `cancelRun(runId)`
- `loadArtifacts(runId)`

Image Studio 可在 `useImageStore` 中只保存 `skillRunIdsBySession`，不要复制完整 run state。

Chat 消息中只持久化 `runId` 和 summary parts，完整事件从 skill runtime API 读取。

## 10. API 契约

### 10.1 Skill 能力发现

```text
GET /api/v1/skills?capability=image&installed=1
```

返回：

```ts
type SkillSummary = {
  id: string
  name: string
  description: string
  version: string
  author?: string
  runtime: string
  capabilities: string[]
  inputSchema: JsonSchema
  outputKinds: string[]
  permissions: SkillPermissionSummary[]
  recommendedSurfaces: SkillRunSurface[]
}
```

### 10.2 创建运行

```text
POST /api/v1/skill-runs
```

输入：

```ts
type CreateSkillRunRequest = {
  skillId: string
  surface: 'skills' | 'chat' | 'image'
  sessionId?: string
  imageSessionId?: string
  input: Record<string, unknown>
  target?: {
    kind: 'chat' | 'image_session' | 'artifact_only'
    id?: string
  }
}
```

输出：

```ts
type CreateSkillRunResponse = {
  data: {
    runId: string
    status: SkillRunStatus
  }
}
```

### 10.3 事件流

```text
GET /api/v1/skill-runs/:runId/events
```

可用 SSE，也可先用轮询。

### 10.4 恢复和确认

```text
POST /api/v1/skill-runs/:runId/resume
```

输入：

```ts
type ResumeSkillRunRequest = {
  approvalId?: string
  approved?: boolean
  patchInput?: Record<string, unknown>
}
```

### 10.5 Artifacts

```text
GET /api/v1/skill-runs/:runId/artifacts
GET /api/v1/skill-artifacts/:artifactId/content
```

对于 image artifact，如果已经写入 `image_generations`，应返回关联字段：

```ts
type ImageSkillArtifact = SkillArtifact & {
  kind: 'image'
  imageGenerationId?: string
}
```

## 11. 文章配图端到端数据流

```text
User
  -> Image Studio: chooses Article Illustration skill
  -> SkillRunConfigForm: paste/upload/url article
  -> POST /skill-runs
  -> SkillRuntime loads SKILL.md and references
  -> SkillRuntime emits plan event
  -> UI shows IllustrationPlanCard
  -> User confirms
  -> POST /skill-runs/:runId/resume
  -> SkillRuntime calls image_gen through SkillToolGateway
  -> image_gen writes image_generations rows
  -> SkillArtifactStore links artifacts to imageGenerationId
  -> ImageStudio renders GenerationCard for each image
  -> SkillRunSummary offers export/download/retry
```

关键设计点：

- `image_generations` 是图片产物的最终展示模型。
- `skill_artifacts` 是 skill run 的审计和导出模型。
- 两者通过 `imageGenerationId` 关联。
- 用户在 Image Studio 看到的是普通图片结果，不需要理解 artifact 表。

## 12. 实现方案对比

### 方案 A：独立 Skills Workbench

做法：

- 新建完整 Skills 工作台。
- 所有 skill 都在 Skills 页运行。
- Chat 和 Image Studio 只提供跳转。

优点：

- 实现边界清晰。
- 运行历史和权限集中。
- 不容易影响现有 Chat / Image Studio。

缺点：

- 用户给文章配图时要离开 AI 画图页。
- 图片产物和重绘流程割裂。
- Chat 中的自然语言意图不能顺滑转成操作。

适合：

- 后台管理型 skills。
- 调试和高级用户。

### 方案 B：Chat-only Skills

做法：

- 所有 skill 都作为 Chat tool 调用。
- 用户通过自然语言触发。
- 图片、报告等都作为 Chat 消息附件返回。

优点：

- 入口简单。
- 复用现有 Chat timeline 和 ApprovalCard。
- 适合研究、写作、问答类 skill。

缺点：

- 图像批量 review、重绘、设为参考图体验弱。
- Chat 消息流承载大量图片会拥挤。
- 用户难以管理图片会话和模板。

适合：

- 轻量 skill。
- 研究报告类 skill。
- 用户不知道要用哪个 skill 的场景。

### 方案 C：Image Studio 深度集成

做法：

- 文章配图、插画生成、批量变体等 image skills 直接成为 AI 画图页模式。
- 右侧面板显示 image-capable skills。
- 产物直接进入 image session。

优点：

- 文章配图体验最好。
- 能复用现有图片生成卡、模板、参考图、重绘能力。
- 用户可以围绕图片持续迭代。

缺点：

- 只覆盖 image skills。
- 研究/PDF/脚本类 skill 仍需要其他入口。
- 如果没有统一 runtime UI，后续会重复造组件。

适合：

- 文章配图。
- 多图插画。
- 批量图像工作流。

### 方案 D：统一 Skill Run Surface，多入口嵌入（推荐）

做法：

- Runtime 和前端运行组件统一。
- Skills 页负责管理和运行历史。
- Chat 负责自然语言触发和轻量过程追踪。
- Image Studio 负责图像密集型运行和产物迭代。

优点：

- 用户可以从最自然的位置开始。
- 不同页面共享事件、权限、artifact、运行历史。
- 文章配图能在 Image Studio 获得最佳体验，同时 Chat 也能触发。
- 长期可扩展到研究、PDF、脚本、插件类 skills。

缺点：

- 首期设计和实现复杂度较高。
- 需要清楚定义 shared components 和状态归属。
- 需要处理 run 在不同 surface 之间跳转/接管。

推荐：

- 采用方案 D。
- 第一阶段先做 image-capable skills 在 Image Studio 的深度集成，同时 Chat 支持 suggestion + handoff。
- Skills 页作为管理和历史中心，不作为主要创作入口。

## 13. 分阶段落地

### Phase 1：Image Skills MVP

目标：

- Skills 页能安装 package skill。
- Image Studio 右侧出现 `Skills` tab。
- 能运行一个文章配图 skill。
- 支持粘贴正文、输入 URL、上传文件。
- 先生成插图计划，用户确认后批量生成。
- 图片进入 Image Studio generation cards。
- artifacts 记录 prompt 和图片。

不做：

- Python 依赖安装。
- MCP/容器。
- 复杂 market。
- 完整跨页面运行接管。

### Phase 2：Chat 触发与 Handoff

目标：

- Chat 根据用户意图推荐 skill。
- Chat 能显示 SkillSuggestionCard。
- Chat 能启动 skill run。
- 图像类 skill 可一键「打开到 AI 画图」。
- Chat 消息持久化 run summary。

### Phase 3：统一 Runs 中心

目标：

- Skills 页新增 `Runs` tab。
- 展示所有 skill run。
- 支持按状态、页面、skill 筛选。
- 支持重新打开 artifacts。
- 支持继续等待确认的 run。

### Phase 4：重型 Skill 支持

目标：

- 研究/PDF 类 skill 的长任务 UI。
- Python/script approval。
- 依赖安装确认。
- PDF/Markdown artifact preview。

## 14. 细节交互

### 14.1 自动推荐不要自动执行

当用户在 Chat 中说「给文章配图」时，系统可以推荐 skill，但不应直接批量生成图片。必须先展示推荐和计划。

原因：

- 可能消耗图片额度。
- 用户可能想选择风格。
- skill 可能来自第三方，需要权限确认。

### 14.2 计划可编辑

文章配图计划不能只是只读列表。至少支持：

- 删除某一张。
- 修改某一张描述。
- 增加一张。
- 重新规划。

### 14.3 单图失败不终止整组

批量出图中某一张失败，应显示：

```text
第 3 张失败
[重试这一张] [跳过] [修改 prompt 后重试]
```

整个 run 状态可以是 `completed_with_errors` 或 `partial_error`，不要简单标记 failed。

### 14.4 结果要能回流

完成后用户可能继续：

- 把某张图设为参考图。
- 基于某张图做同款。
- 替换第 3 张。
- 导出整套图片。
- 回到 Chat 让 AI 写配图说明。

因此 artifact actions 应跨页面：

- `Open in Image Studio`
- `Send to Chat`
- `Use as Reference`
- `Export`

### 14.5 权限文案具体化

不要显示抽象的：

```text
需要 network, image_generation, write_artifacts
```

应显示：

```text
这个 skill 将会：
- 读取你提供的文章
- 生成 6 张图片
- 保存图片和 prompt 到本地运行目录
```

## 15. 空状态和错误状态

### Image Studio Skills 空状态

```text
还没有可用于图像工作流的 Skills
[安装文章配图 Skill] [查看 Market]
```

### Chat Skill 推荐失败

```text
没有找到适合“文章配图”的 Skill
[去安装] [用普通图像生成]
```

### 运行失败

错误卡应包含：

- 当前失败步骤。
- 错误原因。
- 可恢复操作。

示例：

```text
生成第 4 张图片失败
模型返回：内容策略拒绝

[修改这一张的描述] [跳过] [重新生成整组]
```

## 16. 验收清单

### 文章配图主流程

- [ ] 用户能在 AI 画图页选择文章配图 skill。
- [ ] 用户能粘贴正文、输入 URL、上传文章文件。
- [ ] 用户能配置图片数量、比例、风格、模型。
- [ ] 系统先生成插图计划，不直接出图。
- [ ] 用户确认后批量生成图片。
- [ ] 每张图片以 Image Studio `GenerationCard` 展示。
- [ ] 每张图片可下载、复制、重绘、做同款、设为参考图。
- [ ] 完成后有整组导出/产物汇总。

### Chat 入口

- [ ] 用户上传文章并输入「给这篇文章配图」后，Chat 推荐合适 skill。
- [ ] Chat 不自动执行高成本批量出图。
- [ ] Chat 能启动 skill run。
- [ ] 图像类 run 能跳转到 AI 画图页继续。

### Skills 管理

- [ ] Skill 详情展示来源、权限、输入、输出、适用页面。
- [ ] Skill 运行历史可查看。
- [ ] 运行中的 skill 可继续/取消。
- [ ] 权限可撤销。

### 运行体验

- [ ] 长任务有可见进度。
- [ ] 等待确认时 UI 明确阻塞原因。
- [ ] 单个图片失败可局部重试。
- [ ] artifacts 可追溯到 runId。

## 17. 关键结论

Skill Package Runtime 的前端不应只是「Skills 页面新增运行按钮」。更好的体验是：

```text
Skills 页：安装、权限、历史
Chat 页：自然语言触发、推荐、轻量追踪
AI 画图页：文章配图与图像产物工作台
Shared SkillRunSurface：统一运行、确认、事件、产物
```

文章配图类 skill 的最佳路径是：

```text
AI 画图页选择 skill
  -> 粘贴/上传/输入 URL
  -> 配置数量/比例/风格/模型
  -> 生成可编辑插图计划
  -> 用户确认
  -> 批量生成图片
  -> 图片进入 Image Studio
  -> 用户重绘/参考/导出
```

Chat 入口保留自然语言便利性，但图像密集操作应 handoff 到 AI 画图页。这样既保持 Chat 简洁，又让图片工作流拥有专业、可迭代的工作台体验。
