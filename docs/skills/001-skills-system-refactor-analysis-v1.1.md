# BloomAI Skills 系统重构分析

> 状态：Draft
> 版本：v1.1
> 文档编号：001
> 日期：2026-08-05
> 目标：整合 BloomAI 现有 Skills 设计、第三方目录型 Skills 运行时方案与 Mastra Skills 能力，为后续重构计划、任务拆分、接口设计、实现顺序和验收标准提供统一依据。

---

## 0. 摘要与最终结论

### 0.1 最终结论

BloomAI 不应直接把现有 Skills 系统替换成 Mastra Skills。更合理的路线是：

- BloomAI 继续负责产品级的 Skills Control Plane：目录、导入、安装、版本、启停、权限、运行、事件、Artifacts、审计、UI 和生命周期管理。
- Mastra Skills 作为 Agent Runtime Layer：负责在 Agent/Workspace 中发现 Skill、搜索 Skill、读取 SKILL.md 与 references、把激活后的 Skill 指令纳入 Agent 上下文。
- BloomAI Capability and Execution Layer 继续负责文件、网络、图像、浏览器、沙箱、命令、Artifact、审批和任务 Worker 的安全执行。

可以用以下关系概括：

~~~text
Mastra Skills = Agent Runtime Layer
BloomAI Skills = Product Control Plane + Runtime Orchestration
~~~

推荐三层架构：

~~~text
┌─────────────────────────────────────────────────────────┐
│ BloomAI Skill Control Plane                             │
│ Catalog / Import / Install / Version / Permission / UI  │
└──────────────────────────┬──────────────────────────────┘
                           │ SkillVersion + Policy
┌──────────────────────────▼──────────────────────────────┐
│ Mastra Skill Runtime                                    │
│ Workspace.skills / skill / skill_search / skill_read    │
└──────────────────────────┬──────────────────────────────┘
                           │ Tool calls / events
┌──────────────────────────▼──────────────────────────────┐
│ BloomAI Capability and Execution Layer                  │
│ Worker / Broker / FS / Sandbox / Web / Image / Artifact  │
└─────────────────────────────────────────────────────────┘
~~~

### 0.2 最重要的 P0 判断

当前 BloomAI 已经有 Package Runtime 的大量领域模型和代码骨架，但从当前代码结构看，InstructionAgentAdapter 已实现，并不等于已经形成稳定的生产执行闭环。必须首先确认并补齐：

~~~text
POST /skill-runs
  -> 创建持久化 Run
  -> 入队
  -> Skill Worker
  -> InstructionAgentAdapter
  -> Capability Broker
  -> Event / Artifact
  -> succeeded / failed / cancelled / waiting
~~~

如果 startRun 只完成数据库状态写入，而没有稳定 Worker 消费，系统就会出现“可以创建 Run，但不能可靠执行”的假闭环。该问题优先级高于 Mastra Skills 集成和 UI 美化。

### 0.3 重构目标

本次重构不是简单增加一个 Skill 文件读取器，而是把 Skills 从“source 字符串加 runner”升级为“可安装、可版本化、可授权、可运行、可观察、可回滚的 Skill Package Runtime”。

目标能力包括：

1. 兼容现有 js-function、http-api、prompt-template。
2. 支持包含 SKILL.md、references、assets、scripts、templates 的目录型 Skill。
3. 支持本地目录、ZIP、GitHub Archive 和 npx skills 生成目录的导入。
4. 支持 Mastra Agent 通过 Workspace 发现和激活 Skills。
5. 支持长时间运行、等待输入、等待审批、暂停、恢复、取消和崩溃恢复。
6. 支持 Capability Grant、范围限制、过期、撤销和审计。
7. 支持图片、Markdown、HTML、PDF、JSON、Prompt 文件和压缩包等 Artifact。
8. 支持 Skill 版本锁定、差异比较、更新、回滚和删除语义。
9. 支持 Skills 后台、聊天面板和 AI 画图页面的统一产品体验。

---

## 1. 文档范围、术语和边界

### 1.1 本文范围

本文分析以下三个系统的关系：

- BloomAI 现有 Legacy Skill 系统。
- BloomAI 已开始建设的 Skill Package Runtime。
- Mastra 1.51.0 提供的 Skills 能力。

本文不把 Mastra 当作完整的 Skill 市场、安装器、权限系统或企业级运行控制面，而是把它作为可嵌入的 Agent Skill Runtime 进行评估。

### 1.2 术语定义

| 术语 | 定义 |
| --- | --- |
| Skill | 面向 Agent 或业务场景的一组指令、参考资料、工具调用约束和输出约定 |
| Legacy Skill | 现有以 source 字符串和 runner 为核心的轻量技能 |
| Skill Package | 一个可安装、可校验、可版本化的目录型技能包 |
| Skill Version | Skill Package 在某一时刻的不可变内容快照 |
| Installation | 某个项目、用户或工作区对指定 Skill Version 的启用关系 |
| Skill Run | 一次具体的 Skill 执行实例 |
| Capability | Skill 运行时希望使用的受控能力，如 web、image、filesystem、command |
| Grant | 对某次运行、某个会话或某个安装授予的 Capability 权限 |
| Artifact | Skill Run 产生的可持久化输出文件或结构化结果 |
| Control Plane | 管理 Skill 生命周期、策略、版本和产品体验的控制层 |
| Runtime | 读取 Skill 指令、编排 Agent、调用工具并产生运行事件的执行层 |

### 1.3 首期范围建议

建议把首期重构分成可交付的 B-Lite 范围：

- 支持 SKILL.md、references 和只读 assets。
- 支持本地目录、ZIP、GitHub Archive 导入。
- 支持经过安全检查的 npx skills 产物目录导入。
- 使用 Instruction Agent 进行编排。
- 支持 web、用户上传附件、图片生成和 Artifact 保存。
- 暂不在首期开放任意 Python、Shell、自动依赖安装、MCP、容器、子 Agent 和任意工作区写入。

---

## 2. BloomAI 当前实现盘点

### 2.1 主要代码位置

当前 Skills 相关代码主要位于以下绝对路径：

- D:/codeproject/JS/bloomai/src/server/skills/types.ts
- D:/codeproject/JS/bloomai/src/server/skills/run-skill.ts
- D:/codeproject/JS/bloomai/src/server/skills/registry.ts
- D:/codeproject/JS/bloomai/src/server/skills/legacy/
- D:/codeproject/JS/bloomai/src/server/skills/packages/
- D:/codeproject/JS/bloomai/src/server/skills/runtime/
- D:/codeproject/JS/bloomai/src/server/skills/policy/
- D:/codeproject/JS/bloomai/src/server/skills/artifacts/
- D:/codeproject/JS/bloomai/src/server/skills/adapters/instruction-agent-adapter.ts
- D:/codeproject/JS/bloomai/src/server/services/skill-package-runtime.service.ts
- D:/codeproject/JS/bloomai/src/server/http/routes/skills.ts
- D:/codeproject/JS/bloomai/src/server/http/routes/skill-package-runtime.ts
- D:/codeproject/JS/bloomai/src/server/mastra/chat-agent.ts
- D:/codeproject/JS/bloomai/src/server/mastra/workspace/project-workspace.factory.ts

### 2.2 Legacy Skill 系统

Legacy 系统的核心接口仍然很窄，核心思想可以抽象为：

~~~ts
export type SkillRunner = (
  source: string,
  input: object,
  context: SkillExecutionContext
) => Promise<object> | object

export interface SkillExecutionContext {
  skillId: string
}
~~~

现有模型适合以下场景：

- 一次性 Prompt 模板。
- 一次 HTTP API 调用。
- 一段受限制的 JavaScript 函数。
- 输入 JSON，输出 JSON。

现有类型大致包括：

| 类型 | 作用 | 适合场景 | 主要限制 |
| --- | --- | --- | --- |
| js-function | 在受限 JS 环境中执行函数源码 | 转换、清洗、简单逻辑 | 无目录、无 references、无长任务语义 |
| http-api | 组装请求并调用外部 API | 单次服务集成 | 无复杂工作流、无逐步事件 |
| prompt-template | 将输入填入模型 Prompt | 总结、翻译、生成 | 无工具编排、无多 Artifact |

Legacy 系统的优势是简单、容易理解、兼容成本低；问题是它把复杂 Skill 压缩成 source 字符串，无法表达目录结构、参考资料、脚本、权限和输出文件。

### 2.3 Package Runtime 系统

当前 Package Runtime 已经开始引入更接近产品级系统的实体：

~~~text
skill_packages
skill_versions
skill_installations
skill_runs_v2
skill_run_events
skill_artifacts
skill_capability_grants
skill_run_commands
~~~

同时已经出现以下模块边界：

- Package Installer：负责本地目录、ZIP、GitHub Archive 等来源的安装和快照。
- Package Reader：负责读取 Skill manifest、SKILL.md、references、assets。
- Skill Run Coordinator：负责运行状态机和状态转换。
- InstructionAgentAdapter：负责用 Agent 执行 instruction-agent 类型 Skill。
- Capability Broker：集中判断 web、image、filesystem、command 等能力是否允许执行。
- Artifact Store：保存运行产物并进行隔离。
- HTTP Service/Route：提供安装、启停、运行、查询和操作接口。

这一套方向是正确的，但目前仍处于“领域骨架已经形成，生产闭环需要补齐”的阶段。

### 2.4 Mastra 集成现状

BloomAI 当前已经使用 Mastra Agent 和 Mastra Workspace：

- D:/codeproject/JS/bloomai/src/server/mastra/chat-agent.ts 创建 Agent。
- D:/codeproject/JS/bloomai/src/server/mastra/workspace/project-workspace.factory.ts 使用 LocalFilesystem、LocalSandbox 和 Workspace。
- package.json 中的 @mastra/core 版本为 1.51.0。

但当前代码审查结论是：

1. BloomAI 使用了 Workspace，但尚未形成完整的 Workspace.skills 配置。
2. 未发现生产路径中稳定使用 createSkill、skill_search、skill_read 的完整闭环。
3. 尚未把 BloomAI 已安装的 Skill Version 自动映射为 Mastra 可读取的 Skill Source。
4. Mastra 的 Agent 层与 BloomAI Skill Package Control Plane 之间还缺少正式 Adapter。

因此，当前不是“已经使用 Mastra Skills，只需要打开开关”，而是“已有 Mastra Agent/Workspace，可以在此基础上接入 Mastra Skills”。

---

## 3. 现有系统的运行链路与结构性问题

### 3.1 Legacy 运行链路

~~~mermaid
flowchart LR
  A[用户或 API] --> B[skills 路由]
  B --> C[skills 表]
  C --> D[SkillRegistry]
  D --> E{Skill 类型}
  E --> F[js-function]
  E --> G[http-api]
  E --> H[prompt-template]
  F --> I[一次性结果]
  G --> I
  H --> I
~~~

该链路没有把 Skill 目录、版本、权限、事件和 Artifact 作为一等对象，因此适合“函数调用”，不适合复杂工作流。

### 3.2 Package Runtime 目标链路与当前缺口

~~~mermaid
flowchart LR
  A[POST startRun] --> B[Run Coordinator]
  B --> C[Queue]
  C --> D[Skill Worker]
  D --> E[InstructionAgentAdapter]
  E --> F[Mastra Agent / Workspace]
  F --> G[Capability Broker]
  G --> H[Web / Image / Filesystem / Sandbox]
  H --> I[Events]
  H --> J[Artifacts]
  I --> K[Run State]
  J --> K
~~~

当前需要重点验证和补齐的不是图中某一个函数，而是从 C 到 K 的可靠性：

- Worker 是否真正启动并消费 Run。
- Worker 崩溃后是否能够恢复或标记失败。
- waiting_approval、waiting_input 是否可以持久化。
- confirm、modify、cancel 是否能够重新唤醒或终止 Worker。
- 每一个 Tool Call 是否有脱敏事件。
- Artifact 是否能够追溯到 runId、skillVersionId 和用户。

### 3.3 主要结构性问题

| 编号 | 问题 | 影响 | 优先级 |
| --- | --- | --- | --- |
| P0-1 | startRun 到生产 Worker 的执行闭环不明确 | 可能创建 Run 但不执行 | P0 |
| P0-2 | 权限 Grant 创建、审批、恢复闭环不完整 | 高风险工具无法安全使用 | P0 |
| P0-3 | Legacy 与 Package Runtime 两套模型并存 | API、UI、错误和审计不一致 | P0 |
| P1-1 | Skill 以 source 为中心，目录包能力不足 | 无法兼容复杂第三方 Skill | P1 |
| P1-2 | 版本、安装关系和内容哈希需要统一 | 无法可靠更新和回滚 | P1 |
| P1-3 | Artifact、Event 不是所有运行路径的一等输出 | 无法观察和诊断长任务 | P1 |
| P1-4 | GitHub/npx 导入信任边界不清晰 | 可能引入恶意代码或路径逃逸 | P1 |
| P2-1 | UI 管理能力不足 | 用户无法理解 Skill 状态 | P2 |
| P2-2 | 搜索、推荐和能力筛选缺少统一索引 | Skill 数量增长后不可用 | P2 |

---

## 4. Mastra Skills 能力分析

本节以 Mastra 官方 Skills 文档和当前项目使用的 Mastra 1.51.0 为基线。外部参考为：[Mastra Skills](https://mastra.ai/docs/agents/skills)。

### 4.1 Mastra Skills 的定位

Mastra Skills 主要解决的是：让 Agent 能够按需发现、搜索、读取并激活目录型 Skill。Skill 通常以 SKILL.md 作为入口，并可以引用 references、scripts、assets 等辅助文件。

它解决的核心问题是“Agent 如何知道有哪些技能、何时加载技能、如何读取技能说明”，而不是“企业产品如何安装、授权、审计和运营技能”。

### 4.2 Workspace-level Skills

Workspace-level Skills 挂载在 Workspace 上，适合：

- 同一个项目中的多个 Agent 共享一组 Skill。
- 通过项目目录或版本化目录提供团队共用的技能。
- 将 Skill 的可见范围与 Workspace 生命周期绑定。
- 根据项目、租户或会话动态生成 Skill Source。

BloomAI 可以把某个 Project 的已安装 Skill Version 映射为该 Project Workspace 可见的 Skills，但必须先在 BloomAI 控制面完成启用、权限和版本选择。

### 4.3 Agent-level Skills

Agent-level Skills 适合：

- 只有某个 Agent 可以使用的专用技能。
- 根据 Agent 的角色、模型或工作模式动态加载。
- 对不同 Agent 使用不同 Skill Resolver。

BloomAI 不应把所有已安装 Skill 无条件放到所有 Agent。建议通过 projectId + agentId + surface + policy 计算可见 Skill 集合。

### 4.4 skill 工具

skill 的作用是让 Agent 激活或读取某个 Skill 的主说明。适合在模型判断需要某项能力时，把对应 SKILL.md 指令加入当前上下文。

需要注意：

- 激活 Skill 不等于授予所有 Capability。
- 读取 SKILL.md 不等于允许执行 scripts。
- Skill 的 instructions 不是安全策略，最终权限仍由 BloomAI Capability Broker 决定。
- Skill 的上下文注入必须有 Token、深度和引用文件大小限制。

### 4.5 skill_search 工具

skill_search 适合在 Skill 数量较多时，通过关键词、语义或混合检索查找候选 Skill。Mastra 文档涉及 BM25、Vector 和 Hybrid 等搜索策略。

BloomAI 应将搜索分成两层：

1. Control Plane 搜索：按名称、标签、来源、版本、安装状态、能力风险、项目权限筛选。
2. Runtime 搜索：在 Agent 运行过程中搜索可见的 Skill 内容和描述。

两层搜索不能混为一谈。Control Plane 决定“用户或 Agent 是否有权看到”，Mastra Runtime 决定“在可见集合中哪个 Skill 最相关”。

### 4.6 skill_read 工具

skill_read 适合按需读取 Skill 的某个文件或引用内容，例如：

- SKILL.md 的某个章节。
- references/workflow.md。
- references/style-presets.md。
- assets 中的只读示例。

建议 BloomAI 对 skill_read 加入：

- 允许路径白名单。
- 禁止 .. 和符号链接逃逸。
- 单文件大小限制。
- 总读取字节数限制。
- 内容脱敏和敏感文件拒绝。
- 读取事件记录。

### 4.7 Skill Source

Mastra 的 LocalSkillSource 适合直接读取本地目录。VersionedSkillSource 和 CompositeVersionedSkillSource 适合从版本化文件树中提供 Skill，并支持多个版本或多个来源的组合。

BloomAI 的最佳接入方式不是把数据库记录直接伪装成普通字符串，而是：

~~~text
skill_versions
  -> immutable content snapshot
  -> SkillVersionTree
  -> BlobStore / local package directory
  -> VersionedSkillSource
  -> Workspace.skills
  -> Mastra Agent
~~~

这样可以同时保留 BloomAI 的安装、版本和权限语义，以及 Mastra 的 Skill 发现、读取和激活能力。

### 4.8 Dynamic Skills Resolver

动态 Skills resolver 适合 BloomAI 的多项目、多会话和多 Agent 场景。每次请求可以根据以下信息生成不同的可见 Skill 集合：

- 用户身份和租户。
- Project 归属。
- Session 和 Surface：skills、chat、image。
- Skill Installation 是否启用。
- Capability Policy 是否允许。
- 当前模型、Agent 角色和工作模式。

动态 Resolver 应该是只读、可缓存、可审计的，不应在 Agent 运行时偷偷修改安装关系。

### 4.9 Mastra Skills 的优势与边界

| 维度 | Mastra Skills 的优势 | 需要 BloomAI 补齐的能力 |
| --- | --- | --- |
| Agent 上下文 | 原生支持按需加载 Skill 指令 | Token 预算、敏感内容过滤 |
| Skill 发现 | 有 skill、skill_search、skill_read | 权限过滤、产品目录、推荐 |
| 文件结构 | 能处理 SKILL.md、references、assets | 安装、快照、哈希、版本锁定 |
| 搜索 | BM25、Vector、Hybrid | 租户隔离、权限索引、更新任务 |
| Workspace | 适合项目级共享 | 项目安装关系、启停、回滚 |
| 运行编排 | 可被 Agent 使用 | 持久化 Run、Worker、取消、恢复 |
| 工具调用 | 可通过 Agent 工具体系扩展 | Capability Broker、审批、审计 |
| 产品管理 | 不是核心目标 | CRUD、导入、卸载、UI、运营 |

---

## 5. BloomAI 与 Mastra Skills 对比结论

### 5.1 能否直接替换

结论：不能直接替换，只能分层整合。

原因如下：

1. Mastra Skills 解决的是 Agent 运行时上下文管理，BloomAI 需要的是完整产品控制面。
2. Mastra 不会自动替代 BloomAI 的 Skill Catalog、Package Installer、Installation、Capability Grant、Artifact Store 和 Run Coordinator。
3. Mastra 的 Skill 激活不是权限批准。一个 Skill 说明文件可以要求访问文件、网络或图像，但最终必须由 BloomAI 策略层裁决。
4. 直接替换会丢失 BloomAI 已经设计的版本、安装、事件、Artifact 和多业务 Surface 语义。
5. Legacy Skill 仍需要兼容；Mastra Skills 不能天然执行现有 js-function、http-api 和 prompt-template 数据模型。

### 5.2 推荐职责分工

| 能力 | BloomAI | Mastra |
| --- | --- | --- |
| Skill Catalog | 负责 | 消费可见结果 |
| 本地/GitHub/ZIP/npx 导入 | 负责 | 不负责 |
| Package 校验与快照 | 负责 | 消费快照 |
| 版本、安装、启停、回滚 | 负责 | 不负责 |
| Capability Grant | 负责 | 触发工具请求 |
| Skill Discovery | 提供权限过滤后的集合 | 负责 Runtime 搜索 |
| SKILL.md 激活 | 记录状态和策略 | 负责 Agent 上下文接入 |
| references 读取 | 控制路径和限制 | 提供读取入口 |
| Agent 编排 | 提供 Adapter 和上下文 | 负责 Agent Runtime |
| Tool 执行 | Worker/Broker 执行 | 发起调用 |
| Event / Artifact / Audit | 负责持久化 | 提供运行事件来源 |
| UI/运营 | 负责 | 不负责 |

### 5.3 迁移策略

推荐增加 MastraSkillAdapter，而不是重写所有现有 Skill：

- LegacySkillAdapter：继续承载旧三类 Skill。
- PackageSkillAdapter：承载目录型 Skill 和 Instruction Agent。
- MastraSkillAdapter：把安装好的 Skill Version 转换为 Mastra Skill Source 和 Workspace 配置。

统一运行入口：

~~~text
Skill Catalog
  -> resolve installation/version
  -> resolve runtime adapter
  -> create policy-scoped context
  -> enqueue Skill Run
  -> execute through selected adapter
  -> persist events/artifacts
~~~

---

## 6. Skills 的导入、安装、删除、修改和展示设计

### 6.1 导入来源

目标系统至少支持以下来源：

| 来源 | 推荐程度 | 说明 |
| --- | --- | --- |
| 本地目录 | 高 | 开发和内部 Skill 最可靠，直接读取真实目录 |
| ZIP 文件 | 高 | 适合上传、归档和跨机器传输，需要防 Zip Slip |
| GitHub Archive | 高 | 通过 repository URL、ref、subdirectory 生成不可变快照 |
| Git Clone | 中 | 需要网络、凭据和更复杂的缓存策略，可后续支持 |
| npx skills 产物目录 | 高 | 先由受控环境生成目录，再按本地目录导入 |
| 直接执行 npx | 低 | 不建议 BloomAI Server 默认支持 |

当前 skill-package-runtime 路由已经具备 local-directory、zip、github-archive 这类来源模型的方向。后续应把来源解析、下载、解包和安全扫描收敛到 Package Installer。

### 6.2 GitHub 导入

可以从 GitHub 导入 Skill，但推荐导入“仓库归档快照”，而不是在运行时直接依赖 Git 工作树。

流程：

~~~text
输入 repositoryUrl + ref + subdirectory
  -> 校验 URL 与协议
  -> 下载指定 ref 的 archive
  -> 解包到临时目录
  -> 解析 Skill 根目录
  -> 检查 SKILL.md / manifest
  -> 检查路径逃逸、符号链接和文件大小
  -> 计算内容哈希
  -> 生成 SkillVersion
  -> 记录来源、ref、commit、license、capabilities
  -> 供用户确认后安装
~~~

必须记录：

- 仓库 URL。
- ref、tag 或 commit SHA。
- 实际解析到的 commit SHA。
- subdirectory。
- 导入时间和导入用户。
- 内容哈希。
- manifest 声明的能力。
- 实际扫描到的可执行文件。

“GitHub 上的目录存在”不代表“可以直接运行”。导入和执行必须分离，导入阶段只生成待安装版本，执行阶段再次进行策略检查。

### 6.3 npx skills 导入

可以使用 npx skills 获取第三方 Skills，但推荐的安全语义是“把 npx 当作外部导入工具”，而不是“让 BloomAI Server 任意执行 npx”。

推荐流程：

~~~text
开发者或受控导入 Worker
  -> npx skills add <source> --copy
  -> 得到真实本地 Skill 目录
  -> BloomAI 以 local-directory 导入
  -> 扫描、解析、哈希、展示权限
  -> 用户确认安装
~~~

不建议默认实现：

~~~text
BloomAI Server -> spawn npx skills add ...
~~~

原因：

- npx 可能下载并执行任意 npm 包。
- 依赖安装和生命周期脚本会扩大攻击面。
- 网络、凭据、缓存和环境变量容易泄露。
- 运行结果可能不是用户预期的 Skill 目录。
- 服务器权限边界很难依靠单一进程解决。

如果未来必须支持服务端 npx，应使用独立导入 Worker，并满足：

1. 网络出口 allowlist 或默认关闭。
2. 临时容器或沙箱。
3. 禁止读取用户 Home、SSH、npm token 和系统凭据。
4. 禁止安装后自动执行未审查脚本。
5. 限制 CPU、内存、磁盘、时间和下载大小。
6. 导入完成后只把产物目录交给 Package Scanner。
7. 不允许 npx 直接获得 Skill Run 的业务权限。

### 6.4 安装与启用

导入和安装必须分开：

- Import：获得一个待审核的 Skill Version。
- Install：建立用户/项目与 Skill Version 的安装关系。
- Enable：允许某个 Surface 或 Agent 使用。
- Run：在一次具体请求中执行，并按 Run Policy 授权。

建议安装关系包含：

- ownerType、ownerId。
- projectId。
- skillPackageId、skillVersionId。
- enabled。
- defaultSurface。
- policyProfile。
- installedAt、installedBy。
- pinnedVersion。

### 6.5 删除语义

“删除 Skill”必须区分三个动作：

1. Disable：立即停止被新 Run 使用，但保留安装和历史。
2. Uninstall：移除项目或用户的安装关系，保留 Skill Package、版本、Run 和 Artifact 引用。
3. Purge：在没有运行、审计、Artifact 和合规保留要求后，物理删除包内容。

默认 UI 操作应是 Disable 或 Uninstall，不应直接物理删除不可逆数据。正在运行的 Skill 不能被静默删除，应进入“停止新运行、等待当前运行完成或强制取消”的流程。

### 6.6 修改语义

已安装的 Skill Version 不应原地修改，否则会破坏 Run 可追溯性。建议使用以下方式：

- Edit Draft：创建可编辑草稿版本。
- Create New Version：保存新的内容哈希和 manifest。
- Fork：从第三方 Skill 复制为 BloomAI 私有包。
- Patch/Overlay：仅在明确标记为本地覆盖时使用。
- Rollback：把 Installation 指向旧的不可变版本。

任何修改都应产生新的版本号、内容哈希和版本差异记录。需要比较：

- SKILL.md 内容差异。
- references 文件差异。
- scripts/assets 文件差异。
- requestedCapabilities 差异。
- 运行时类型差异。
- 依赖和许可证差异。

### 6.7 功能展示和 UI

建议把 Skills UI 设计成四个层级：

#### A. Skills Center

展示：

- 全部 Skill、已安装、已启用、待审批、运行中、失败。
- 名称、描述、来源、版本、风险级别、能力标签。
- 过滤：项目、Surface、来源、能力、状态、更新时间。
- 操作：导入、安装、启用、禁用、卸载、更新、回滚、删除草稿。

#### B. Skill Detail

展示：

- Skill 名称、版本、来源和内容哈希。
- SKILL.md 渲染预览。
- 目录树：references、assets、scripts、templates。
- 所需 Capability 与实际 Grant。
- 安装到哪些项目和 Workspace。
- 最近运行、成功率、耗时、Artifacts。
- 版本历史和 Diff。

#### C. Run Detail

展示：

- 输入摘要和运行上下文。
- 当前状态和状态转换时间线。
- Step、Tool Call、审批、重试和错误。
- 事件流和脱敏后的参数。
- 输出、Artifacts、部分失败和取消原因。

#### D. Chat/Image 集成

- Chat 中显示 Skill 激活、等待审批和 Artifact 链接。
- Image 页面显示 Skill 计划、图片生成进度、失败重试和导出。
- 不能只把 Skill 当作隐藏 Prompt；用户应知道当前使用了哪个版本和哪些能力。

---

## 7. 目标架构设计

### 7.1 三层架构

~~~mermaid
flowchart TB
  subgraph CP["BloomAI Skill Control Plane"]
    Catalog[Catalog]
    Import[Import and Scanner]
    Version[Version and Snapshot]
    Install[Installation]
    Policy[Capability Policy and Grant]
    API[HTTP API and UI]
    Audit[Audit]
  end

  subgraph RT["Skill Runtime"]
    Resolver[Visibility Resolver]
    Mastra[Mastra Workspace Skills]
    Agent[Instruction Agent]
    Legacy[Legacy Runner Adapter]
    Coord[Run Coordinator]
    Worker[Skill Worker]
  end

  subgraph EX["Capability and Execution Layer"]
    Broker[Capability Broker]
    FS[Filesystem]
    Web[Web and Browser]
    Image[Image Generation]
    Sandbox[Sandbox and Commands]
    Events[Event Store]
    Artifacts[Artifact Store]
  end

  Catalog --> Import
  Import --> Version
  Version --> Install
  Install --> Resolver
  Policy --> Resolver
  Resolver --> Mastra
  Resolver --> Legacy
  API --> Coord
  Coord --> Worker
  Worker --> Agent
  Worker --> Legacy
  Agent --> Broker
  Legacy --> Broker
  Broker --> FS
  Broker --> Web
  Broker --> Image
  Broker --> Sandbox
  Broker --> Events
  Broker --> Artifacts
  Events --> Audit
~~~

### 7.2 领域对象

#### SkillPackage

代表逻辑上的 Skill，不直接等于某个目录或某个版本。

建议字段：

- id、slug、name、description。
- owner、visibility、sourceType。
- createdBy、createdAt、updatedAt。
- lifecycle：active、disabled、archived。

#### SkillVersion

代表不可变的内容快照。

建议字段：

- id、skillPackageId、versionLabel。
- contentHash、manifestHash。
- rootPath 或 Blob reference。
- sourceMetadata：repositoryUrl、ref、commitSha、subdirectory。
- runtime：legacy、instruction-agent、future-plugin。
- requestedCapabilities。
- scannerResult、license、riskLevel。
- createdAt、createdBy。

#### SkillInstallation

代表使用关系。

建议字段：

- id、skillPackageId、skillVersionId。
- ownerType、ownerId、projectId。
- enabled、defaultForSurface。
- pinned、policyProfile。
- installedAt、installedBy。

#### SkillRun

代表一次执行，必须是持久化状态机。

建议状态：

~~~text
created
  -> validating
  -> queued
  -> running
  -> waiting_input
  -> waiting_approval
  -> cancelling
  -> succeeded
  -> completed_with_errors
  -> failed
  -> cancelled
~~~

状态不应靠自由字符串随意更新，必须集中在 SkillRunCoordinator 中校验合法转换。

#### SkillCapabilityGrant

建议区分：

- once：只对当前一次 Tool Call 或当前 Run 有效。
- session：对当前会话有效。
- persistent：对指定 Installation 或 Project 有效。

每个 Grant 需要有：

- capability。
- scope。
- grantedBy。
- expiresAt。
- revokedAt。
- source：user、policy、admin、system。
- audit reference。

#### SkillArtifact

建议字段：

- id、runId、skillVersionId。
- kind、mimeType、storageKey。
- size、sha256。
- visibility、expiresAt。
- parentArtifactId。
- createdAt。

#### SkillRunEvent

事件类型至少包括：

- run.created。
- run.queued。
- run.started。
- skill.loaded。
- reference.read。
- step.started。
- tool.requested。
- approval.requested。
- approval.granted。
- tool.completed。
- artifact.created。
- run.waiting。
- run.failed。
- run.cancelled。
- run.succeeded。

### 7.3 核心不变量

1. Skill Version 内容不可变。
2. Run 必须绑定 skillVersionId，而不能只绑定 skillPackageId。
3. Artifact 必须绑定 runId，不能只存一个文件路径。
4. Tool Call 必须经过 Capability Broker，不能由 Agent 直接绕过。
5. disabled 的 Installation 不影响历史 Run，但不能创建新 Run。
6. Uninstall 不删除历史 Run 和审计记录。
7. 删除或更新 Skill 不应改变过去 Run 的可复现性。
8. 同一个 Run 的状态转换必须幂等。
9. 用户提交的 projectId、ownerId 不能直接成为信任来源，必须从会话关系和服务端上下文解析。

---

## 8. Mastra 接入的具体设计

### 8.1 SkillVersion 到 Mastra Source 的映射

推荐新增 MastraSkillAdapter，职责是把 BloomAI 的安装结果转换为 Mastra 所需的 Skill Source：

~~~text
SkillInstallation + SkillVersion + RunPolicy
  -> Visibility Resolver
  -> SkillVersionTree
  -> VersionedSkillSource or CompositeVersionedSkillSource
  -> Workspace.skills
  -> Agent tools: skill / skill_search / skill_read
~~~

Adapter 不负责：

- 创建或删除安装关系。
- 绕过 Capability Broker。
- 直接执行 scripts。
- 修改数据库版本。
- 私自给出 persistent Grant。

### 8.2 Workspace 级和 Agent 级的使用策略

建议默认采用 Workspace 级安装、Agent 级可见性过滤：

- Project Workspace 负责提供已安装 Skill 的版本树。
- Visibility Resolver 根据 Agent、Surface、Session 和 Policy 过滤。
- Agent 只能看到当前运行允许看到的 Skill。
- Chat 和 Image 可以共享已安装包，但可见集合和能力 Grant 可以不同。

### 8.3 动态 Resolver 伪代码

~~~ts
type SkillVisibilityContext = {
  projectId: string
  sessionId: string
  surface: 'skills' | 'chat' | 'image'
  agentId: string
  userId: string
}

async function resolveVisibleSkills(context: SkillVisibilityContext) {
  const installations = await installationRepo.listEnabledForProject(context.projectId)
  const allowed = []

  for (const installation of installations) {
    const version = await versionRepo.get(installation.skillVersionId)
    const policy = await policyService.resolve(context, version)

    if (!policy.visible) continue

    allowed.push({ installation, version, policy })
  }

  return buildMastraSkillSource(allowed)
}
~~~

### 8.4 Tool 调用和权限闭环

Mastra 的 skill、skill_search、skill_read 只代表 Skill Runtime 的入口。真正的工具调用应经过 BloomAI：

~~~text
Agent decides to use a Skill
  -> Mastra skill activation
  -> Skill requests web/image/filesystem/command
  -> BloomAI Capability Broker
  -> policy check
  -> existing Grant?
  -> execute or waiting_approval
  -> event + artifact
  -> resume Agent
~~~

当结果为 waiting_approval 时，必须把等待状态持久化，不应让 HTTP 请求或进程内 Promise 成为唯一状态。

### 8.5 Legacy Skill 的兼容

不要把 Legacy Skill 强行转成 SKILL.md。建议保留其原生执行器，并使用统一外壳：

- 输入校验统一。
- Run 状态统一。
- Capability 检查统一。
- Event 和 Artifact 统一。
- 错误模型统一。
- UI 展示统一。

这样用户看到的是一个统一 Skill 产品，而内部允许多个 Runtime Adapter 并存。

---

## 9. 权限、安全与隔离设计

### 9.1 Skill 声明不是权限授予

Skill manifest 中的 requestedCapabilities 只能表达“希望使用什么”，不能直接变成“可以使用什么”。最终权限必须经过：

~~~text
Manifest declaration
  -> static scanner
  -> installation policy
  -> per-run policy
  -> user/admin approval
  -> Capability Broker
  -> audited execution
~~~

### 9.2 Capability 分级

建议首期能力分级：

| Capability | 风险 | 首期策略 |
| --- | --- | --- |
| skill_read | 低至中 | 仅限 Skill 根目录和 references，默认只读 |
| workspace_read | 中 | 仅限项目工作区白名单 |
| workspace_write | 中至高 | 首期关闭或每次审批 |
| web_search | 中 | 可用，记录查询并限制域名/频率 |
| image_generate | 中 | 可用，限制模型、数量、成本 |
| browser | 高 | 独立审批和会话隔离 |
| command | 极高 | 首期关闭，后续独立沙箱 |
| python | 极高 | 后续沙箱，不在 B-Lite |
| network_raw | 高 | 默认关闭，采用域名 allowlist |

### 9.3 包安装安全检查

安装时至少执行：

- 根目录归一化。
- Zip Slip 检查。
- 符号链接检查。
- 目录深度和文件数量限制。
- 单文件和总包大小限制。
- 隐藏敏感文件检查，如 .env、私钥、token、凭据目录。
- manifest 和 SKILL.md 结构检查。
- 代码/脚本扩展名扫描。
- package.json、依赖声明和 install script 扫描。
- License 和来源信息记录。
- 内容哈希和重复内容检测。

### 9.4 运行时安全检查

每一次 Run 仍需要检查：

- Installation 是否启用。
- Run 绑定的 Skill Version 是否仍可用。
- Surface 是否允许使用。
- 当前用户和 Project 是否有权限。
- Capability Grant 是否有效、未过期、未撤销。
- Path 是否在允许根目录内。
- 资源预算是否超限。
- 输出 Artifact 是否写入隔离存储。

### 9.5 事件和日志脱敏

Event 不能原样记录所有 Prompt、Cookie、Authorization、文件内容和个人信息。建议：

- 对请求头、token、密码、Cookie 做强制脱敏。
- 对大文本只记录摘要、长度、哈希和安全采样。
- 对用户上传文件记录 metadata 和 Artifact 引用，不默认复制全文。
- Event 与 Artifact 分开设置保留策略。
- 管理员查看高风险事件需要审计。

---

## 10. API 目标设计

现有路由和服务可以继续演进，但最终需要统一 Legacy 与 Package Runtime 的产品 API。

### 10.1 Catalog 和 Package

~~~text
GET    /api/skills
GET    /api/skills/:skillId
GET    /api/skills/:skillId/versions
POST   /api/skill-packages/import
POST   /api/skill-packages/:skillId/versions
GET    /api/skill-packages/:skillId/tree
GET    /api/skill-versions/:versionId/diff
~~~

### 10.2 Installation

~~~text
GET    /api/skill-installations
POST   /api/skill-installations
PATCH  /api/skill-installations/:installationId
POST   /api/skill-installations/:installationId/enable
POST   /api/skill-installations/:installationId/disable
POST   /api/skill-installations/:installationId/rollback
DELETE /api/skill-installations/:installationId
~~~

### 10.3 Run

~~~text
POST   /api/skill-runs
GET    /api/skill-runs
GET    /api/skill-runs/:runId
GET    /api/skill-runs/:runId/events
POST   /api/skill-runs/:runId/confirm
POST   /api/skill-runs/:runId/modify
POST   /api/skill-runs/:runId/cancel
GET    /api/skill-runs/:runId/artifacts
~~~

### 10.4 Capability Grant

~~~text
GET    /api/skill-capability-grants
POST   /api/skill-capability-grants
POST   /api/skill-capability-grants/:grantId/revoke
~~~

### 10.5 API 设计约束

- 所有 ID、Project、Session 关系由服务端验证。
- Run 的 skillVersionId 必须固定，不能执行到一半自动漂移到最新版本。
- POST 操作应支持幂等键，避免重复启动 Run。
- 事件接口优先支持 SSE 或可恢复轮询。
- 错误响应统一携带 code、message、runId、retryable 和 details。
- 长任务 API 返回 Run，不阻塞 HTTP 请求等待最终结果。

---

## 11. 数据库与持久化重构建议

### 11.1 迁移机制优先

当前如果只依赖 CREATE TABLE IF NOT EXISTS，无法可靠升级已有数据库。应先建立：

- schema_migrations 表。
- 顺序迁移执行器。
- 事务和幂等执行。
- 启动时先 migrate，再 seed。
- 空库、旧库升级、失败回滚测试。

建议把 Skill Runtime 迁移拆成：

~~~text
001-skill-runtime-core
002-skill-runtime-events
003-skill-runtime-artifacts
004-skill-capability-grants
005-skill-runtime-indexes
~~~

### 11.2 Legacy 和新模型的映射

不要在第一阶段直接删除旧表。建议：

- 保留旧 skills 和 skill_runs。
- 建立 Canonical Skill Catalog 读模型。
- 使用 LegacySkillAdapter 把旧记录映射为统一 Skill Summary。
- 新包使用 PackageSkillAdapter。
- 统一 Run 查询时提供 runtimeType 和 legacyId。
- 完成迁移和回归测试后，再评估旧表退役。

### 11.3 可复现性

每个 Run 至少持久化：

- skillPackageId。
- skillVersionId。
- contentHash。
- runtimeType。
- model/provider。
- input 摘要或安全引用。
- policy profile。
- granted capabilities。
- createdAt、startedAt、finishedAt。
- workerId 和 retryCount。

---

## 12. UI 重构方向

### 12.1 Skills Center 信息架构

~~~text
Skills Center
├── All Skills
├── Installed
├── Enabled
├── Pending Approval
├── Running
├── Failed
├── Drafts
└── Import
    ├── Local Directory
    ├── ZIP
    ├── GitHub
    └── npx Output Directory
~~~

### 12.2 用户必须看懂的状态

- Imported：已导入但尚未安装。
- Installed：已建立安装关系。
- Enabled：允许被新 Run 发现。
- Waiting Approval：等待用户授权某项能力。
- Running：Worker 正在执行。
- Completed with Errors：部分步骤失败，但有可用结果。
- Failed：运行失败。
- Disabled：禁止新运行。
- Outdated：存在新版本但当前仍锁定旧版本。
- Quarantined：扫描发现风险，需要人工处理。

### 12.3 运行详情设计

Run 页面必须同时展示“模型行为”和“系统控制行为”：

- Skill 激活了什么。
- 读取了哪些 reference。
- 请求了哪项 Capability。
- 哪一步等待审批。
- 哪个工具调用失败。
- 生成了哪些 Artifact。
- 是否有 partial failure。
- 是否发生重试、取消和恢复。

不要只展示最终回答，否则用户无法判断 Skill 是真的执行了、只读了文档，还是因为权限拒绝而没有完成。

### 12.4 功能展示的产品原则

- 管理页展示事实：版本、来源、权限、安装关系、运行历史。
- Chat 展示过程摘要：Skill 名称、审批、关键进度和结果。
- Image 页面展示业务进度：计划、图片生成、失败重试、下载。
- 高级事件和详细参数进入 Run Detail，不污染普通聊天。

---

## 13. 重构原则

1. **先闭环，后扩展**：先保证 Run 能入队、执行、记录、完成、失败和取消。
2. **控制面与运行时分离**：Mastra 不替代 BloomAI 的管理和权限系统。
3. **版本不可变**：修改生成新版本，Run 永远绑定具体版本。
4. **能力集中治理**：所有高风险工具都经过 Capability Broker。
5. **导入执行分离**：导入只产生快照，执行必须再次授权。
6. **兼容优先**：Legacy Skill 不因新架构上线而失效。
7. **默认最小权限**：Skill 的声明不能自动获得持久权限。
8. **事件和 Artifact 一等化**：长任务必须可观察、可恢复、可审计。
9. **UI 反映真实状态**：不以静态按钮模拟未实现的 Worker 或权限能力。
10. **逐阶段启用**：新 Runtime 使用 feature flag，支持快速关闭和回滚。

---

## 14. 后续重构计划与 task 拆分基础

以下任务编号可作为后续实施计划的初始骨架。

### Phase 0：执行闭环和基线

- **SR-0001**：为 Package Runtime 增加 feature flag、运行开关和 kill switch。
- **SR-0002**：确认 startRun -> queue -> worker -> adapter 的生产链路。
- **SR-0003**：实现 Skill Worker，支持幂等消费、重试、超时和崩溃恢复。
- **SR-0004**：把 InstructionAgentAdapter 接入生产 Worker。
- **SR-0005**：把 confirm、modify、cancel 接入持久化 Run 状态机。
- **SR-0006**：为 Legacy Skill 增加统一 Run/Event 外壳。
- **SR-0007**：补齐 Legacy 与 Package Runtime 的最小回归测试和端到端测试。

交付标准：一个本地目录 Skill 能从创建 Run 走到完成，并能看到事件、输出和失败原因。

### Phase 1：权限闭环

- **SR-0101**：实现 Capability Grant 创建 API。
- **SR-0102**：支持 once、session、persistent 三种 Grant 生命周期。
- **SR-0103**：实现 waiting_approval 持久化、UI 确认和恢复。
- **SR-0104**：实现 Grant 过期、撤销和审计。
- **SR-0105**：为 web、image、filesystem、command 定义 scope schema。
- **SR-0106**：为 Capability Broker 增加集中策略测试。

交付标准：Skill 请求 image 或 web 时能进入审批；用户同意后可以恢复，拒绝后有可解释失败。

### Phase 2：统一 Legacy 与 Package Domain

- **SR-0201**：建立 Canonical Skill Catalog。
- **SR-0202**：实现 LegacySkillAdapter。
- **SR-0203**：实现 PackageSkillAdapter。
- **SR-0204**：统一 Skill Summary、Detail、Run、Error 模型。
- **SR-0205**：统一 skills 后台列表、详情和运行记录。
- **SR-0206**：建立旧表到统一读模型的迁移与回归测试。

交付标准：用户无需知道 Skill 属于 Legacy 还是 Package Runtime，也能统一管理和查看。

### Phase 3：Mastra Skills 接入

- **SR-0301**：实现 SkillVersionTree 和内容快照访问层。
- **SR-0302**：实现 MastraSkillAdapter。
- **SR-0303**：接入 VersionedSkillSource 或 CompositeVersionedSkillSource。
- **SR-0304**：配置 Project Workspace 的 skills。
- **SR-0305**：接入 skill、skill_search、skill_read。
- **SR-0306**：实现动态 Visibility Resolver。
- **SR-0307**：把 Mastra Skill 事件映射到 BloomAI Run Event。
- **SR-0308**：增加 Token、路径、读取字节和引用深度限制。

交付标准：Agent 只能搜索和激活当前 Project、Surface、Policy 允许的 Skill Version。

### Phase 4：版本、更新和回滚

- **SR-0401**：实现 GitHub ref/commit 锁定。
- **SR-0402**：实现 Skill Version Diff。
- **SR-0403**：实现 manifest 和 Capability Diff。
- **SR-0404**：实现更新检查和用户确认。
- **SR-0405**：实现 side-by-side 安装。
- **SR-0406**：实现回滚和运行中版本保护。
- **SR-0407**：实现旧版本清理和保留策略。

交付标准：更新 Skill 不影响历史 Run，可以一键恢复到旧版本。

### Phase 5：导入和产品 UI

- **SR-0501**：完善本地目录导入。
- **SR-0502**：完善 ZIP 导入并防止 Zip Slip。
- **SR-0503**：完善 GitHub Archive 导入。
- **SR-0504**：增加 npx 产物目录导入。
- **SR-0505**：实现 Skills Center。
- **SR-0506**：实现 Skill Detail、Tree、Diff、Permission 页面。
- **SR-0507**：实现 Run Detail、事件流和 Artifact 页面。
- **SR-0508**：接入 Chat 和 Image 页面。

交付标准：用户可以导入、查看、安装、启用、运行、审批、禁用、卸载和回滚 Skill。

### Phase 6：安全、性能和可观测性

- **SR-0601**：建立 Package Scanner。
- **SR-0602**：增加 symlink、路径逃逸、敏感文件和恶意脚本检查。
- **SR-0603**：建立缓存、索引和增量扫描。
- **SR-0604**：限制并发、Token、时间、磁盘和网络预算。
- **SR-0605**：增加 metrics、trace 和失败分类。
- **SR-0606**：建立运行目录清理、Artifact 保留和容量告警。
- **SR-0607**：完成安全回归、负载测试和故障注入测试。

---

## 15. 关键验收场景

### 15.1 Legacy 兼容

- 现有 js-function 运行结果保持兼容。
- 现有 http-api 的参数校验和错误语义保持兼容。
- 现有 prompt-template 不需要迁移即可运行。
- 新旧 Skill 都能出现在统一列表中。

### 15.2 目录型 Skill

- 导入包含 SKILL.md、references 和 assets 的本地目录。
- Skill 能搜索到并读取指定 reference。
- Agent 能根据 Skill 指令调用允许的 web 或 image 能力。
- 单个步骤失败时 Run 能进入 completed_with_errors，并保留已生成 Artifact。

### 15.3 GitHub 导入

- 导入指定 repository URL、tag 或 commit。
- 生成 contentHash 和 source metadata。
- 能展示 subdirectory 和实际 commit SHA。
- GitHub 内容变更不会改变已经安装的旧版本。
- 可安装新版本并回滚。

### 15.4 npx 导入

- 可以将 npx skills 生成的真实目录以 local-directory 导入。
- BloomAI 不会在普通 Skill Run 中直接执行 npx。
- 导入结果经过同样的扫描、哈希、权限确认和版本化。
- 包含危险脚本或敏感文件时进入 Quarantined。

### 15.5 权限与恢复

- Skill 请求受保护能力时进入 waiting_approval。
- 用户批准后 Worker 能恢复，而不是重新创建 Run。
- 用户拒绝后 Run 有明确原因和审计事件。
- Grant 过期或撤销后，后续 Tool Call 被拒绝。

### 15.6 Worker 可靠性

- Worker 重启后能恢复 queued/running 的可恢复 Run。
- 同一 Run 不会因重复投递产生重复 Artifact。
- 超时、取消和重试行为可观察。
- HTTP 请求断开不影响后台 Run。

### 15.7 UI 和审计

- 用户可以看到 Skill Version、来源和能力。
- 用户可以查看运行事件和 Artifact。
- 用户可以禁用、卸载和回滚而不破坏历史记录。
- 管理员可以追溯谁导入、谁安装、谁授予权限、谁运行了 Skill。

---

## 16. 风险与待决策事项

### 16.1 主要风险

| 风险 | 说明 | 缓解策略 |
| --- | --- | --- |
| 任意代码执行 | scripts、npx、依赖安装可能执行恶意代码 | 导入扫描、隔离 Worker、首期禁用 command/python |
| Prompt 注入 | Skill 文件或外部网页可能诱导 Agent 越权 | Skill instructions 不作为策略，Broker 强制裁决 |
| 版本漂移 | 运行中使用了最新目录而非固定版本 | Run 固定 skillVersionId 和 contentHash |
| 状态丢失 | 进程内 Promise 结束后等待状态消失 | Run/Event 持久化和恢复 Worker |
| 权限泄露 | Grant 范围过大或过期不撤销 | scope schema、expiresAt、revoke 和审计 |
| 数据泄露 | Event 或 Artifact 暴露 Prompt、token 或用户文件 | 脱敏、隔离、访问控制和保留策略 |
| 资源耗尽 | 多图生成、搜索和大文件导致成本失控 | 时间、Token、并发、大小和费用预算 |
| 双系统漂移 | Legacy 和 Package 规则不一致 | Canonical Catalog 和统一运行壳 |

### 16.2 待决策问题

1. Skill Installation 的默认归属是用户、Project 还是 Workspace？建议首期以 Project 为主。
2. Skill Version 是否允许手动编辑？建议只编辑 Draft，不修改已安装版本。
3. 是否需要 Skill Marketplace？建议先做导入和内部 Catalog，市场化后置。
4. 是否在首期执行脚本？建议不执行任意 Python/Shell，先完成 Instruction Agent + 受控工具。
5. Mastra Skills 的搜索索引由谁维护？建议 BloomAI 维护可见性和生命周期，Mastra 维护 Runtime 索引。
6. 是否允许一个 Run 使用多个 Skill？建议允许，但每个激活 Skill 都要记录版本和可见性决策。
7. 运行 Artifact 是否永久保留？建议按 Project/租户策略分层保留。
8. 是否支持自动更新？建议默认不自动更新，先做检测、Diff、用户确认和回滚。

---

## 17. 推荐里程碑

~~~text
M0 安全与持久化地基
  -> M1 安全 Package 安装
  -> M2 Instruction Agent Runtime
  -> M3 文章配图后端闭环
  -> M4 Skills Center 与 AI 画图产品闭环
  -> M5 兼容、测试、性能和安全加固
~~~

| 里程碑 | 主要内容 | 可交付结果 |
| --- | --- | --- |
| M0 | Worker、Run 状态机、迁移、权限基础 | 运行可持久化、可恢复 |
| M1 | Package Installer、Scanner、Version | 可安全导入和安装目录型 Skill |
| M2 | InstructionAgentAdapter、Mastra Adapter | Agent 可发现、读取和激活 Skill |
| M3 | Web/Image/Artifact/Event | 文章配图等复杂 Skill 形成闭环 |
| M4 | Skills Center、Chat、Image UI | 用户可管理和观察 Skill |
| M5 | 兼容、负载、故障注入、安全 | 可以稳定扩大 Skill 数量和运行规模 |

实施顺序约束：

1. 迁移系统必须早于新表上线。
2. Skill Version 快照必须早于更新和回滚。
3. 持久化 Run 状态机必须早于等待审批和长任务 UI。
4. Capability Broker 必须早于开放 web、image、filesystem 等高风险能力。
5. Event 脱敏和 Artifact 隔离必须早于第三方 Skill 导入。
6. Python、Shell、自动依赖安装、MCP 和容器不能混入 B-Lite 的核心路径。

---

## 18. 参考资料与关联文档

### 18.1 外部参考

- [Mastra Skills 官方文档](https://mastra.ai/docs/agents/skills)
- [Mastra First-class Skills 介绍](https://mastra.ai/blog/introducing-first-class-skills)
- [Vercel Labs Skills CLI](https://github.com/vercel-labs/skills)

### 18.2 BloomAI 本地参考文档

- D:/codeproject/JS/bloomai/docs/skills/third-party-skills-runtime-architecture.md
- D:/codeproject/JS/bloomai/docs/skills/skill-package-runtime-ux-and-integration-design.md
- D:/codeproject/JS/bloomai/docs/skills/skill-package-runtime-b-lite-implementation-todo.md

### 18.3 代码基线

- D:/codeproject/JS/bloomai/src/server/skills/adapters/instruction-agent-adapter.ts
- D:/codeproject/JS/bloomai/src/server/services/skill-package-runtime.service.ts
- D:/codeproject/JS/bloomai/src/server/http/routes/skill-package-runtime.ts
- D:/codeproject/JS/bloomai/src/server/mastra/chat-agent.ts
- D:/codeproject/JS/bloomai/src/server/mastra/workspace/project-workspace.factory.ts
- D:/codeproject/JS/bloomai/package.json

---

## 19. 一句话总结

BloomAI 的正确方向不是“用 Mastra Skills 取代 BloomAI Skills”，而是“让 BloomAI 负责 Skill 的产品控制面和安全执行，让 Mastra 负责 Agent 运行时的 Skill 发现、搜索、读取与激活，并通过版本化 Skill Source、Capability Broker、Worker、Event 和 Artifact 把两者连接成一个可治理的系统”。
