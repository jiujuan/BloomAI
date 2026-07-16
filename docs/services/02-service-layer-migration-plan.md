# BloomAI Services 层迁移计划

> 日期：2026-07-16  
> 状态：阶段 0、1、2 的代码迁移、自动化验证和本地 API smoke test 已完成；阶段 1、2 的 Renderer 页面人工 smoke test 待在可交互桌面会话中执行；阶段 3–5 待执行
> 前置文档：[Services 层架构分析](./01-service-layer-architecture-analysis.md)  
> 目标：在不破坏现有前后端 API、流式协议和本地数据兼容性的前提下，将后端 API 调用路径逐步统一为 `HTTP Route → Application Service → Repository / Runtime`。

## 1. 迁移原则

### 1.1 先定边界，再迁移实现

第一步不是移动所有文件，而是把依赖规则、错误模型、测试策略和完成标准写成可执行约束。没有约束的文件移动只能把问题从一个目录搬到另一个目录。

### 1.2 保持行为兼容

在任意阶段，不得无意改变：

- 现有 HTTP path、method、请求字段、响应字段和状态码；
- `{ data }` / `{ error: { code, message } }` 响应约定；
- Chat 的 AI SDK/SSE 流事件和前端消费方式；
- 已存在的数据库 schema、migration 和本地数据；
- Renderer 的 `platform` API 调用方式；
- 本地图片、附件和 artifact 的可访问性。

如确实需要 API 协议变更，必须作为单独设计和独立迁移，不与 services 层抽取混合。

### 1.3 小步、可验证、可回滚

每个阶段必须：

1. 先建立或确认当前行为的测试；
2. 将一个垂直业务域迁到 Service；
3. 保持 Route API 不变；
4. 运行该域定向测试；
5. 运行类型检查；
6. 阶段完成后运行完整测试和生产构建；
7. 以小提交提交，确保可独立回滚。

### 1.4 不创建空洞的“转发层”

简单 CRUD 也需要 service 边界以维持一致性，但不应创建只有一行转发、没有输入类型/错误语义/扩展位置的伪抽象。Service 至少应承担下列之一：

- 输入归一化或业务校验；
- 领域错误语义；
- API DTO 映射；
- 跨 Repo 协作；
- 事务、权限、状态机或审计；
- 为后续 IPC、CLI、job 或 tool 调用提供复用入口。

## 2. 当前工作区约束

截至 2026-07-16，以下 Skill Package Runtime 相关文件已有未提交修改：

- `src/server/http/routes/skill-package-runtime.ts`
- `src/server/http/routes/skill-package-runtime.test.ts`
- `src/server/http/routes/article-illustrations.e2e.test.ts`
- `src/server/skills/adapters/instruction-agent-adapter.test.ts`
- `src/server/skills/artifacts/artifact-store.ts` 及其测试
- `src/server/skills/packages/package-installer.test.ts`
- `src/server/skills/packages/package-reader.test.ts`
- `src/server/skills/policy/capability-broker.test.ts`
- `src/server/skills/runtime/skill-run-events.test.ts`

因此：

- **不要**在这些功能改动未稳定前抽取 `skill-package-runtime.service.ts`；
- 不要把功能修复、UI 修改和架构迁移混在一个提交；
- 该区域迁移开始前，先确认现有功能变更已通过测试并已独立提交或明确冻结。

## 3. 目标依赖规则

### 3.1 允许的依赖方向

```text
src/server/http/routes/**
  → src/server/services/**
  → src/server/db/repositories/**
  → database

src/server/services/**
  → src/server/llm/**
  → src/server/mastra/**
  → src/server/skills/**
  → src/server/attachments/**
  → src/server/tools/**
  → telemetry/logger
```

### 3.2 禁止的依赖方向

```text
http/routes/** → db/repositories/**
http/routes/** → llm/**（仅 type/公共 contract 的例外应明确登记）
http/routes/** → mastra/**
http/routes/** → skills/** 内部 runtime、installer、artifact store
repositories/** → services/**
repositories/** → llm / mastra / skills / attachments
services/** → http/routes/** 或 Hono Context
```

### 3.3 可暂时保留的 HTTP 特例

以下仍属于 HTTP 层职责，但其业务查询/安全校验必须交由 service：

- SSE、AI SDK stream response 的 HTTP 封装；
- `Content-Type`、`Cache-Control`、`Content-Disposition`；
- 二进制文件 response 的最终写出；
- HTTP request 的 `AbortSignal` 传递；
- Zod 的请求格式校验和 error response 映射。

## 4. 阶段 0：基线与基础设施

### 4.1 目标

建立服务层的最低公共能力，并记录当前行为基线；本阶段不迁移任何业务 Route，不移动大批文件。

### 4.2 工作项

1. 新建 `src/server/services/errors.ts`。
   - 定义稳定的 `ServiceError` / `DomainError`；
   - 支持 `VALIDATION_ERROR`、`NOT_FOUND`、`CONFLICT`、`FORBIDDEN`、`UNSUPPORTED_MODEL`、`EXTERNAL_SERVICE_ERROR`、`INTERNAL_ERROR`；
   - 不包含 Hono、HTTP status 或 route 细节。

2. 新建 `src/server/http/error-mapper.ts`。
   - 输入为未知异常或 `ServiceError`；
   - 输出符合现有 `{ error: { code, message } }` 的 Hono response；
   - 明确未知异常不会泄漏敏感 provider / filesystem 信息；
   - 保留需要特殊处理的 stream error 适配机制，不在本阶段重写。

3. 约定 service 输入/输出类型。
   - 输入使用 `CreateXInput`、`UpdateXInput`、`ListXInput` 等业务类型；
   - 输出使用 API 所需 DTO，不暴露 `*_json`、`is_enabled: 0 | 1` 等数据库表达；
   - 除非必要，不新增 class；优先 module + function/service object。

4. 建立依赖边界检查。
   - 首选 ESLint `no-restricted-imports`；当前项目无正式 lint 规则时，可先增加 Vitest/脚本架构测试；
   - 第一版只检查生产 route 文件，不检查测试文件；
   - 规则生效前先处理例外，避免以大量 ignore 注释掩盖问题。

5. 建立回归基线。
   - 记录所有 route 的现有 endpoint；
   - 对 P0 域确认有 route/integration test；
   - 对缺失的关键行为补测试，不先改实现。

### 4.3 验收标准

- 新错误模型可被 service 使用，HTTP error mapper 输出维持现有错误 envelope；
- 尚未迁移的 API 行为无变化；
- 边界检查能够发现 Route 新增的 Repo 直连；
- `npm run typecheck`、相关测试、`npm test`、`npm run build` 全部通过。

### 4.4 回滚策略

本阶段只新增基础设施，可通过单个提交整体回滚；不包含 schema 和 endpoint 变更。

### 4.5 执行记录（2026-07-16）

本阶段只补齐公共基础设施和回归基线，**没有迁移任何生产业务 Route，也没有移动 Chat、LLM、Image Studio 或 Skill Package Runtime 的实现文件**。

已完成内容：

- 新增 `src/server/services/errors.ts`：提供不包含 HTTP/Hono 细节的 `ServiceError`、稳定错误码和类型守卫；
- 新增 `src/server/http/error-mapper.ts`：将 `ServiceError` 映射为既有 `{ error: { code, message } }` envelope；未知异常统一返回 `500 / INTERNAL_ERROR / Internal server error`，原始异常只记录到服务端日志；
- `src/server/http/app.ts` 已通过同一个 Hono error handler 接入 mapper；stream Route 暂未改造；
- 新增 `src/server/architecture/dependency-boundaries.ts` 和 `npm run test:architecture`。检查范围仅为生产 `src/server/http/routes/` 中的非测试 TypeScript 文件，阻止 Route 新增对 Repository、LLM、Mastra、Skills Runtime、Attachments 实现的直连；已有直连被逐文件登记在临时 allowlist 中，后续迁移每完成一个域必须同步删除对应例外，不能新增例外绕过规则；
- P0 endpoint/依赖盘点沿用 [Services 层架构分析第 3 节](./01-service-layer-architecture-analysis.md#3-当前代码盘点)，并补齐 LLM（modality/provider 输入校验）与 Image Studio（模板筛选/生成必填字段）的 Route contract 测试；Chat Plan 与 Skill Package Runtime 使用既有 Route 测试作为基线；
- 为避免 Windows 本地环境中默认并发 Vitest worker 对数据库迁移和 Mastra/Observability 初始化产生间歇性超时，`npm test` 固化为单个 fork worker。它牺牲部分并发速度以获得可重复的全量回归结果；并发优化应在测试隔离改造后另行处理，不能以放宽超时掩盖问题。

本次验证结果：

```text
npm run test:architecture  -> passed (1 file, 3 tests)
npm run typecheck          -> passed
npm test                   -> passed (57 files, 243 tests, 126.40s)
npm run build              -> passed
```

构建仍输出 Vite CJS API deprecation 和 renderer chunk 大小警告；它们不是本阶段新增的编译失败，也不影响本次构建通过。后续阶段如涉及前端性能，应单独处理 code splitting。
## 5. 阶段 1：先迁移低风险 CRUD 域，验证模式

### 5.1 推荐迁移顺序

1. `personas.ts` → `persona.service.ts`
2. `settings.ts` → `settings.service.ts`
3. `sessions.ts` → `session.service.ts`

这些域能验证最核心的 Route → Service → Repo 链路，同时风险显著低于 Chat、LLM 和 Skill Runtime。

### 5.2 Persona Service

新建：`src/server/services/persona.service.ts`

建议职责：

- `list()`；
- `get(id)`；
- `create(input)`；
- `update(id, input)`；
- `remove(id)`；
- 内置 Persona 不可删除规则；
- 将不存在和不可删除转换为领域错误。

改造：`src/server/http/routes/personas.ts`

- Route 只保留 body 读取/格式校验、service 调用和 HTTP response；
- 删除 `personaRepo` 的 import；
- `FORBIDDEN` 的最终 HTTP 映射由统一 error mapper 决定，必要时兼容既有前端期望的 status code。

测试：

- 新增 `persona.service.test.ts`，覆盖内置 Persona 删除限制；
- 保留/补充 Route 测试，验证 201、404、错误 envelope；
- 运行 persona 路由和 service 测试。

### 5.3 Settings Service

新建：`src/server/services/settings.service.ts`

建议职责：

- `listForClient()`：统一 API key 脱敏；
- `getForClient(key)`：决定哪些 key 可读取、如何脱敏；
- `update(input)`：设置更新的 key 白名单、类型归一化和审计扩展点；
- 不让 Route 自己维护 `MASKED_KEYS`。

安全要求：

- 永远不把未脱敏密钥返回给 Renderer；
- 记录配置字段分类，而不是只靠散落的字符串数组；
- 更新 API 不得意外写入不可写 key。

测试：

- 密钥脱敏；
- 缺失 key；
- 批量更新；
- 服务层返回对象不包含原始密钥。

### 5.4 Session Service

新建：`src/server/services/session.service.ts`

建议职责：

- 会话创建、读取、更新、删除；
- 会话消息的分页、total 计算和 DTO 输出；
- 删除会话时的关联数据行为由 service 明确，而不是隐藏在 Route/Repo 调用顺序中；
- 将 message/session record 转为稳定 API 数据。

测试：

- 分页 `limit` / `offset` 边界；
- 不存在的 session；
- 删除行为及关联消息行为；
- route response 的 `meta.total` 保持兼容。

### 5.5 阶段验收

- 三个 Route 不再导入 Repository；
- 相关 service 单元测试与 Route 测试通过；
- 前端 Personas、Settings、Sessions 页面手工 smoke test 通过；
- 完整验证命令通过。

### 5.6 执行记录（2026-07-16）

已完成的迁移：

- 新增 `src/server/services/persona.service.ts`，承接 Persona 的查询和 CRUD 编排。不存在的 Persona 统一抛出 `NOT_FOUND`；内置 Persona 删除统一抛出 `FORBIDDEN`，由公共 error mapper 输出标准错误 envelope 和 `403`。
- 新增 `src/server/services/settings.service.ts`，集中定义 public/secret 字段分类、密钥脱敏和可写白名单。`GET /settings` 与 `GET /settings/:key` 均不会返回原始密钥；已兼容包含连字符的自定义 provider key，例如 `my-provider_api_key`。
- 新增 `src/server/services/session.service.ts`，负责会话 CRUD、消息分页与 `meta.total`。删除会话继续沿用现有软归档语义：归档后不再出现在活动列表中，关联消息保留。
- `src/server/http/routes/personas.ts`、`settings.ts`、`sessions.ts` 现在仅处理 HTTP 输入/输出并调用 Service；三者的临时 Route → Repository 例外已从 `src/server/architecture/dependency-boundaries.ts` 删除。
- 为三个域分别补充了 Service 单元测试和 Route contract 测试，覆盖创建/更新/删除、`NOT_FOUND`、`FORBIDDEN`、设置项白名单和脱敏、Session 分页及软归档行为。

验证记录：

- `npm run test:architecture`：3/3 通过；
- `npm test`：63 个测试文件、264 个测试通过；
- `npm run typecheck`：通过；
- `npm run build`：通过。构建仍输出既有的 Vite CJS API deprecation 与 renderer chunk-size 警告，未产生编译或构建错误；
- 使用独立临时数据目录和本地服务端口 `3719` 完成 API smoke test：Persona create/update/list/delete，Settings 更新/读取/密钥脱敏（含自定义 provider key），Session create/update/list/messages/delete 均通过。测试数据已在验证后删除。

前端手工 smoke test 的执行说明：本次自动化环境无法操作桌面 Electron 窗口，且默认 `3718` 端口已有运行中的 BloomAI 实例；为避免修改现有用户数据，未在该实例中执行点击操作。因此 Personas、Settings、Sessions 页面的人工作业仍需在可交互桌面会话中按上述 API 对应流程完成并记录结果。除该人工 UI 验收项外，阶段 1 的代码迁移和自动化/API 验证已完成。

## 6. 阶段 2：LLM Service 与 Image Studio 扩展（P0）

### 6.1 为什么先做这一阶段

LLM 和图片模块包含外部 provider、配置、持久化和本地文件，因此最能验证“Service 编排 Repo + Runtime”的目标架构；同时图片模块已经存在 `image-studio.service.ts`，可作为迁移样板。

### 6.2 抽取 `llm.service.ts`

新建：`src/server/services/llm.service.ts`

从 `src/server/http/routes/llm.ts` 迁移：

- Provider list/create/update；
- Model list/create/update；
- `config_json` / `capabilities_json` 的安全解析；
- provider/model DTO 映射；
- API key 是否存在的判定（settings 与环境变量回退）；
- modality 校验；
- Ollama remote model discovery；
- 视频任务创建与读取。

建议公开 API：

```ts
listProviders(): ProviderSummary[]
createProvider(input: CreateProviderInput): ProviderSummary
updateProvider(id: string, input: UpdateProviderInput): ProviderSummary
listModels(input: ListModelsInput): ModelSummary[]
createModel(input: CreateModelInput): ModelSummary
updateModel(id: string, input: UpdateModelInput): ModelSummary
listRemoteOllamaModels(providerId: string): Promise<RemoteModelSummary[]>
createVideoTask(input: CreateVideoTaskInput): Promise<VideoTaskDto>
getVideoTask(id: string): Promise<VideoTaskDto>
```

实现要点：

- `llmRepo` 保持数据库访问职责，不承担 provider 逻辑；
- `getSettingValue`、环境变量判断封装在 service 或注入的 credential resolver；
- Route 不再导入 `llmRepo`、`src/server/llm` 或 `src/server/llm/settings`；
- 保持现有 provider/model JSON 字段到 camelCase API 字段的返回结构；
- 为单元测试提供依赖注入 seam，或使用当前模块 mock 模式；
- 不在本阶段改变 Provider registry 或模型选择实现。

测试要求：

- provider id 冲突；
- 无效 kind/modality；
- 更新不存在资源；
- settings / env 中 API key 的可用性；
- Ollama 远程发现失败；
- 视频任务创建和读取；
- `http/routes/llm.ts` 原有 API 契约回归。

### 6.3 扩展 `image-studio.service.ts`

目标：`src/server/http/routes/images.ts` 不再直接导入图片相关 Repo，也不直接读本地文件。

在现有 service 上增加：

```ts
listSessions()
createSession(input)
updateSession(id, input)
deleteSession(id)
listGenerations(sessionId)
listTemplates(category)
generateForSession(input)                // 保留既有能力
openGeneratedImage(id): ImageFileResult  // 返回安全的文件描述或 stream
```

实现要点：

- session/generation 查询也通过 service 返回；
- `openGeneratedImage` 负责 generation 查询、路径存在性、允许目录校验以及 content type；
- Route 仅把 service 返回的 buffer/stream 写为 HTTP body 并设置 cache header；
- 模板查询是否在 service 内调用 shared template module，应由 service 对 Route 隔离；
- 保持 `/images`、`/image-sessions`、`/media/image/:id` API 不变。

测试要求：

- 生成参数校验及 Unsupported Model；
- session CRUD；
- generation 列表；
- 不存在/不安全图片路径；
- 本地图片 response 的 content-type、cache-control 和 404；
- 现有 `image-studio.service.test.ts` 扩展覆盖新用例。

### 6.4 阶段验收

- `llm.ts` 和 `images.ts` 不再直连 Repo、LLM runtime 或文件系统；
- LLM Settings、Provider/Model 管理、图片工作台在 Renderer 中可完整操作；
- LLM 和 Image 的定向测试、全量测试、类型检查、构建均通过；
- 对至少一个 mock provider 和本地文件图片链路完成手工 smoke test。

### 6.5 执行记录（2026-07-16）

已完成的迁移：

- 新增 `src/server/services/llm.service.ts`。该 Service 统一 Provider/Model 的列表、创建、更新、DTO 映射、`config_json` / `capabilities_json` 安全解析、Settings/环境变量 API key 判定、modality 校验、Ollama 远程模型发现及视频任务创建/读取；它提供依赖注入 seam 以支持业务级单元测试。
- `src/server/http/routes/llm.ts` 现仅承担 HTTP JSON 适配和 legacy LLM runtime error 的状态码兼容；不再直接导入 `llmRepo`、LLM runtime 或 LLM settings 模块。`LLM_PROVIDER_ERROR`、`LLM_UNSUPPORTED_MODEL` 等既有错误码继续按原 Route 合约返回。
- 扩展 `src/server/services/image-studio.service.ts`，纳入图片 session CRUD、generation 历史、模板筛选、安全打开本地生成图片和既有生成编排。`openGeneratedImage` 会校验 generation、限制路径位于配置的图片根目录内、推断 content type，并以 `NOT_FOUND` 隐藏不存在/越界路径的文件系统细节。
- `src/server/http/routes/images.ts` 现仅处理 HTTP 输入、错误响应与二进制 body/header 写出；不再直接导入 image session/generation Repo、文件系统或 image templates shared module。
- 已从 `src/server/architecture/dependency-boundaries.ts` 删除 `llm.ts` 和 `images.ts` 的临时 allowlist 例外。阶段 2 未触及 Chat、SSE/AI SDK stream、Provider registry 或模型选择流程。

测试和验证记录：

- 阶段定向测试：`src/server/services/llm.service.test.ts`、`src/server/http/routes/llm.test.ts`、`src/server/services/image-studio.service.test.ts`、`src/server/http/routes/images.test.ts` 共 4 个测试文件、25 个测试通过，覆盖 Provider/Model 校验和错误、视频/Ollama runtime 透传、图片 session/history/template、图片生成参数、越界图片路径及媒体 header/body 合约。
- `npm run test:architecture`：1 个测试文件、3 个测试通过；`npm run typecheck`：通过；`npm test`：64 个测试文件、277 个测试通过（150.69s）；`npm run build`：通过。构建仍输出既有 Vite CJS API deprecation 与 renderer chunk-size 警告，未产生编译或构建错误。
- 使用隔离临时 `DATA_DIR`、动态本地端口 `59092` 和隐藏短生命周期 server 完成 API smoke：`/health`、LLM Provider create/update/list、Image Model create/filter、Image Session create/update/generation list、模板筛选、缺少字段的 `/images` `400 / VALIDATION_ERROR`、本地 fixture 的 `/media/image/:id` `200 / image/png`、`private`、`max-age=31536000`、`immutable` 缓存指令及缺失图片 `404 / NOT_FOUND` 均符合预期。未调用真实外部 provider；临时 server 已停止，临时数据已删除。

Renderer 人工 smoke 的执行说明：当前自动化环境不能操作 Electron 桌面窗口，且默认 `3718` 端口已有用户运行中的 BloomAI 实例。为避免修改该实例及其本地数据，本阶段未对其执行点击操作。因此 LLM Settings/Provider/Model 管理和 Image Studio Renderer 页面仍需在可交互桌面会话中完成手工 smoke 并记录结果；除该人工 UI 验收项外，阶段 2 的代码迁移、自动化验证和隔离 API/本地文件链路验证均已完成。
## 7. 阶段 3：抽取 Chat Service（P0，高风险）

### 7.1 核心原则：不一次性重写流协议

Chat 是高风险路径。服务层迁移的第一目标是移动业务编排位置，不是替换 AI SDK、SSE 或前端流 reducer。

第一版必须保持：

- 现有 `handleChatStream` 调用模式；
- 现有 `createUIMessageStreamResponse` 响应方式；
- 前端对 stream parts 的消费；
- plan 相关的 `data-plan` 输出；
- deep-research workflow 与 team agent 的选择规则；
- user/assistant 消息持久化时序。

### 7.2 推荐拆分顺序

不要一次创建巨型 `chat.service.ts` 后复制 300 多行逻辑。按以下顺序提取：

1. **Chat 输入归一化**
   - model、mode、sessionId、team agent、plan、writing 的解析；
   - 提取为纯函数，可独立单测；
   - Route 仍保留 HTTP header 读取。

2. **消息与附件上下文服务**
   - 迁移 `persistUserMessage`；
   - 迁移附件对象归一化、文本提取、总字符预算、注入最后一个 user message；
   - service 依赖 message/session Repo 和 attachment service；
   - 重点验证附件总预算、非法附件、持久化内容。

3. **Plan 用例服务**
   - `POST /chat/plan` 的 prompt 组装、planner 调用、任务解析/去重/上限；
   - Route 保留 JSON response；
   - 对 malformed LLM 输出建立完整单测。

4. **Chat runtime orchestration**
   - 迁移 deep workflow、team agent、memory routing、Mastra `handleChatStream` 调用；
   - service 返回协议无关的 `ChatStreamResult`（可持有现有 AI SDK stream）；
   - Route 负责将它封装为 `createUIMessageStreamResponse`。

5. **Stream 事件契约抽象（独立后续任务）**
   - 仅在 Service 抽取稳定后，按 `docs/llm/llm-response-contract-v1-design.md` 逐步引入 stream contract mapper；
   - 不与本阶段混合。

### 7.3 建议接口

```ts
export type StreamChatInput = {
  sessionId: string
  mode: string
  model: string
  agentTab?: string
  messages: unknown[]
  plan?: unknown
  writing?: unknown
  attachments?: unknown
  abortSignal?: AbortSignal
}

export const chatService = {
  async proposePlan(input: ProposeChatPlanInput): Promise<{ tasks: string[] }> { /* ... */ },
  async stream(input: StreamChatInput): Promise<ChatStreamResult> { /* ... */ },
  async saveAssistantMessage(input: SaveAssistantMessageInput): Promise<MessageDto> { /* ... */ },
}
```

约束：

- `ChatStreamResult` 不暴露 Hono Context；
- Route 可以暂时使用 AI SDK 类型写 HTTP response；
- 后续 stream contract 改造在 service 内增加 adapter，而不是再次把 provider/Mastra chunk 逻辑放回 Route；
- service 内应保存业务级日志、trace context 和可安全暴露的错误信息，Route 只负责 HTTP/SSE 适配。

### 7.4 测试要求

- Chat plan：空 query、异常 LLM 输出、重复任务、数量上限、avoid 列表；
- 消息持久化：用户消息先保存、assistant 保存的 API 保持兼容；
- 附件：非法对象过滤、单附件截断、总预算、提取失败；
- agent 选择：general、team agent、deep workflow；
- memory：session/resource 传递；
- abort signal：客户端取消不留下错误状态；
- 流：保持 `data-plan` 注入时序和前端已消费的 event/part 类型；
- 现有 `chat-plan.test.ts` 继续通过，并补充 service unit tests；
- Renderer Chat 页面执行真实本地服务器 smoke test。

### 7.5 阶段验收

- `http/routes/chat.ts` 不直接导入 Repo、Mastra、附件 service 或 writer prompt 领域实现；
- Route 的主要内容是 HTTP 输入、`chatService` 调用、stream response 和 error mapping；
- 流协议没有非预期改变；
- 普通聊天、团队 Agent、深度研究、计划模式、附件聊天和会话恢复可手工验证；
- 全部自动化验证通过。

## 8. 阶段 4：Tools、Skills 与 Package Runtime

### 8.1 Tools Service

新建：`src/server/services/tool.service.ts`

迁移 `http/routes/tools.ts` 的：

- 工具列表/详情/统计/运行记录；
- 权限授予/撤销；
- legacy tool capability 执行；
- 运行记录和错误映射。

Route 不再直连 `toolRepo` 或 capability broker。

测试重点：权限状态、执行失败、运行记录分页、同一工具的授权/撤销回归。

### 8.2 Skills Service

新建：`src/server/services/skill.service.ts`

迁移 `http/routes/skills.ts` 的：

- market 和 installed list；
- install/uninstall/delete；
- legacy skill 与 package skill reference 的解析；
- `runSkill` 调用和运行记录。

测试重点：legacy/package reference 兼容、不能运行资源、安装状态、错误码兼容。

### 8.3 Skill Package Runtime Service

前置条件：当前未提交 runtime 功能改动已经独立稳定、测试通过、提交或冻结。

新建：`src/server/services/skill-package-runtime.service.ts`

按用例拆分服务方法，而不是把 Route 整体搬入一个 300 行函数：

```text
inspectPackage
installPackage
listPackages
getPackageDetail
setInstallationEnabled
revokeCapabilityGrant
removeInstallation
startRun
listRuns
getRun
listRunEvents
executeRunCommand
cancelRun
listRunArtifacts
readArtifactContent
exportArtifact
```

Service 编排：

```text
skillPackageRepo
PackageInstaller
SkillRunCoordinator
ArtifactStore
capability policy / broker
```

Route 只保留 Zod 输入校验、page query 解析和 HTTP/二进制 response。`HttpApiError` 等 HTTP 专属错误需逐步替换为 service error + HTTP mapper。

测试重点：安装失败、grant 撤销、状态转换冲突、artifact 不存在、导出二进制、运行取消、事件顺序。

## 9. 阶段 5：Article Illustrations 与 Attachments 边界收口

### 9.1 Article Illustrations

当前 `articleIllustrationService` 已使 Route 基本遵循 Route → Service。后续工作：

- 将 `ArticleSourceError` 纳入通用 service error 层，或者在 service façade 统一转换；
- Route 不直接判断领域错误类别；
- 确认 `sourceSchema`、`sceneSchema` 等 HTTP 输入校验仍可保留在 Route；
- 保持文章抓取、规划、确认、重试、恢复、导出接口不变。

### 9.2 Attachments

当前 `attachment-service.ts` 具有 service 性质。应明确两类用例：

```text
saveUploadedAttachment(input)
extractAttachmentText(attachment)
```

- Route 只处理 multipart/HTTP 输入和 response；
- Chat service 通过 attachment service 获取上下文，不经 Route；
- 文件路径、允许扩展名、大小、文本截断、安全校验集中在 attachment service。

## 10. 阶段 6：依赖规则强制与文档收口

### 10.1 强化架构检查

当所有生产 Route 已迁移后，将临时架构测试升级为持续规则：

- Route 禁止 import Repo；
- Route 禁止 import `llm/**`、`mastra/**`、Skill Runtime 内部实现；
- Repo 禁止 import Service/HTTP/runtime；
- Service 禁止 import Hono Route；
- 例外必须写入一个明确的 allowlist，并说明原因、负责人和移除阶段。

### 10.2 更新项目文档

更新：

- 本目录的架构分析和迁移计划进度；
- `README.md` 中的后端架构说明（如有）；
- API/开发文档中的目录职责；
- 新增或更新 ADR，记录“HTTP Route 只能通过 Application Service 调用业务能力”的决定。

### 10.3 移除过渡代码

全部消费者切换并经过完整验证后：

- 删除 Route 中过渡期 mapper/兼容分支；
- 删除重复的 DTO 转换；
- 删除无引用 helper；
- 不保留永久性的双路径调用；
- 使用 `rg` 和架构检查确认没有遗留 Route → Repo 依赖。

## 11. 每阶段验证矩阵

### 11.1 必须运行的自动化命令

在开始任何阶段前与完成任何阶段后，至少执行：

```powershell
npm run typecheck
npm test
npm run build
```

对于变更的业务域，先执行定向测试，再执行全量测试。例如：

```powershell
npm test -- src/server/http/routes/llm.ts src/server/services/llm.service.test.ts
npm test -- src/server/http/routes/images.ts src/server/services/image-studio.service.test.ts
npm test -- src/server/http/routes/chat-plan.test.ts src/server/services/chat.service.test.ts
```

> 如 Vitest 的文件过滤参数与上述写法不兼容，应使用项目实际支持的 `vitest run <test-file>` 形式。不能以“测试命令未运行”替代完整验证。

### 11.2 后端 API smoke test

每个 P0 阶段完成后，以本地真实 server 运行以下场景：

| 域 | 必测场景 |
|---|---|
| LLM | Provider/Model CRUD、密钥脱敏、Ollama 发现失败处理、视频任务查询 |
| Image Studio | session CRUD、图片生成、历史列表、生成图片文件读取 |
| Chat | 普通聊天、计划、附件、团队 Agent、deep mode、取消请求 |
| Skill Runtime | 安装、授权、运行、事件、取消、artifact 读取/导出 |

可使用 API 集成测试、Playwright 或人工 smoke test；涉及真实外部 Provider 时，自动化测试必须用 mock/fake，人工 smoke test 可使用开发环境可用凭据。

### 11.3 前端端到端 smoke test

迁移本身虽不改变 Renderer API，但必须验证前后端完整运行：

1. 启动开发环境；
2. Renderer 能连接本地 server；
3. 打开并使用受影响功能页；
4. 刷新页面，确认持久化数据和流式状态不异常；
5. 检查浏览器/Electron console 与 server 日志无未处理错误；
6. 必要时打包并启动产物，验证本地路径、数据库和图片/附件读取。

### 11.4 最终验收门禁

全部阶段结束后，必须以新鲜命令输出作为证据确认：

```powershell
npm run typecheck
npm test
npm run build
```

并完成：

- Route → Service → Repo/Runtime 依赖检查；
- API endpoint contract 回归；
- Renderer 关键页面 smoke test；
- Chat 流式交互 smoke test；
- 图片/附件/Skill artifact 本地文件链路 smoke test；
- clean install 或至少 production build 验证；
- 将每项结果记录在迁移 PR/任务中。

没有上述新鲜验证证据，不得宣称迁移完成。

## 12. 提交与回滚策略

### 12.1 推荐提交粒度

每个垂直域使用独立提交或独立 PR：

1. service error + error mapper + architecture check；
2. persona/settings/session；
3. llm service；
4. image studio service 扩展；
5. chat service 的每个小阶段；
6. tools/skills；
7. skill package runtime；
8. 文档和 lint rule 强化。

单个提交应尽量同时包含：service、Route 改造、service/Route 测试和必要的文档更新。不要提交“只移动实现但没有测试”的中间状态。

### 12.2 回滚原则

- 不改变数据库 schema 的 service 抽取可通过回滚单个域提交恢复；
- API 输出/状态码有变化时先停止扩大迁移，比较 contract test 和前端调用；
- Chat 流事件异常时立即恢复上一版 Route 到旧调用路径，同时保留已抽出的纯 helper 测试；
- 不要通过同时维护两份长期业务逻辑来回滚；临时 feature flag 只用于短期高风险 Chat 切换，并设置删除期限。

## 13. 任务清单

### Phase 0：基础设施

- [x] 定义 service error 类型和单元测试。
- [x] 实现 HTTP error mapper 与 Route 兼容测试。
- [x] 添加 Route/Repo/Runtime 依赖边界检查。
- [x] 盘点 P0 endpoint 和已有测试，补齐缺口。
- [x] 执行基线 `typecheck`、全量测试、build。

### Phase 1：低风险域

- [ ] 实现 `persona.service.ts` 并迁移 Route。
- [ ] 实现 `settings.service.ts` 并迁移 Route。
- [ ] 实现 `session.service.ts` 并迁移 Route。
- [ ] 运行定向、全量和前端 smoke test。

### Phase 2：LLM 与图片

- [x] 实现 `llm.service.ts`、DTO mapper 和测试。
- [x] 迁移 `http/routes/llm.ts`。
- [x] 扩展 `image-studio.service.ts` 的 session、历史、模板和文件读取用例。
- [x] 迁移 `http/routes/images.ts`。
- [ ] 运行 Renderer 人工 smoke test（定向/全量、provider mock、本地 API 与图片文件链路 smoke 已完成；待可交互桌面会话执行）。

### Phase 3：Chat

- [ ] 提取纯输入归一化 helper 并测试。
- [ ] 提取消息持久化/附件上下文服务并测试。
- [ ] 提取 plan 用例并测试。
- [ ] 提取 chat runtime orchestration，保持 stream 协议不变。
- [ ] 迁移 `http/routes/chat.ts` 为薄 Route。
- [ ] 验证普通聊天、计划、附件、team agent、deep mode 和取消。

### Phase 4：Tools / Skills / Package Runtime

- [ ] 实现并迁移 `tool.service.ts`。
- [ ] 实现并迁移 `skill.service.ts`。
- [ ] 等当前 skill runtime 功能改动稳定后，实现并迁移 `skill-package-runtime.service.ts`。
- [ ] 完成 artifact、状态机、权限与取消的回归测试。

### Phase 5：收口与发布验证

- [ ] 收口 Article Illustrations 和 Attachments 的错误边界。
- [ ] 启用严格架构规则并清理例外。
- [ ] 更新 README/ADR/开发文档。
- [ ] 执行完整自动化测试、build 和前后端手工 smoke test。
- [ ] 记录验证输出、风险和回滚点。

## 14. 完成定义

迁移仅在以下条件全部满足时才算完成：

1. 所有生产 HTTP Route 只通过 application service 访问业务能力；
2. Route 不直接导入 Repository、LLM runtime、Mastra runtime 或 Skill Runtime 内部实现；
3. Repository 只承担持久化，不反向依赖 service 或外部 runtime；
4. 所有 service 都有业务级单元测试；
5. 所有受影响 Route 都有 HTTP contract/integration 测试；
6. Chat 的流式协议和 Renderer 消费保持兼容；
7. 本地图片、附件和 artifact 文件链路可用；
8. `npm run typecheck`、`npm test`、`npm run build` 以新鲜输出全部通过；
9. Renderer 与本地 server 的关键功能 smoke test 完成并留存结果；
10. 依赖边界检查没有未登记违规项。
