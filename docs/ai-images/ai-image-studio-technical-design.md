# AI 画图（AI Image Studio）技术与架构实现方案

> 版本：v1.0 · 状态：Draft · 日期：2026-07-01
> 配套 PRD：[ai-image-studio-prd.md](./ai-image-studio-prd.md)
> 代码基线：`feat/answer-copy-actions` 分支

---

## 1. 目标与设计原则

在**尽量复用现有架构、最小改动**的前提下，落地一个独立「AI 画图」功能：

- **复用现有 LLM 注册表**：模型目录走已有 `llm_providers` / `llm_models`（`modality=image`），不另造模型体系。
- **复用现有图像链路**：以 [`src/server/llm/media/image.ts`](../../src/server/llm/media/image.ts) 的 `generateImage()` 为核心，抽象为 Provider 适配器可扩展多模型。
- **对齐 config-driven 模式**：比例 / 风格用 [`@shared/writing.ts`](../../src/shared/writing.ts) 同款「单一配置表驱动前后端」的做法，新增 [`@shared/image-gen.ts`](../../src/shared/image-gen.ts)。
- **对齐页面注册模式**：新增独立页面沿用 `useUIStore.activePage` + `App.tsx` 分支 + `NavSidebar` 的既有做法。
- **Local-first**：出图落地本地文件，记录入 SQLite。
- **为扩展预留**：异步任务（Midjourney）与第三方 Skills 画图预留清晰接口。

---

## 2. 现状盘点（Anchors）

| 关注点 | 现状 | 位置 |
|--------|------|------|
| 页面路由 | `activePage` 联合类型 + `App.tsx` 条件渲染 + `NavSidebar` 列表 | [store/index.ts:246](../../src/renderer/store/index.ts), [App.tsx:73](../../src/renderer/App.tsx), [NavSidebar.tsx:9](../../src/renderer/components/layout/NavSidebar.tsx) |
| 多栏布局 | 仅 Chat 是双栏（SessionList + ChatPanel） | [App.tsx:73](../../src/renderer/App.tsx) |
| 图像生成 | `generateImage()` 分发 openai/agnes；支持 size/quality/image[]/saveTo | [media/image.ts:9](../../src/server/llm/media/image.ts) |
| 请求契约 | `ImageGenerationRequest` / `ImageGenerationResult` | [llm/types.ts:60](../../src/server/llm/types.ts) |
| 模型注册表 | DB 驱动，`resolveModel(id,'image')` / `listModels('image')` | [llm/registry.ts:43](../../src/server/llm/registry.ts) |
| 模型 seed | `dall-e-3` / `agnes-image-2.1-flash` 已 seed | [db/client.ts:232](../../src/server/db/client.ts) |
| HTTP 路由 | 有 `/llm/videos`（同步创建+`GET :id` 轮询）**但无 image 路由** | [http/routes/llm.ts:131](../../src/server/http/routes/llm.ts) |
| 前端 API | `platform.*` 封装 `apiFetch(API_BASE + path)` | [renderer/api/index.ts:58](../../src/renderer/api/index.ts) |
| Config 驱动样例 | `WRITING_TYPES` 表驱动前端下拉 + 后端 prompt | [shared/writing.ts](../../src/shared/writing.ts), [WriterParams.tsx](../../src/renderer/pages/Chat/WriterParams.tsx) |
| 会话/消息表 | `sessions` / `messages`（`parts` 存 UI 片段 JSON） | [db/schema.ts:12](../../src/server/db/schema.ts) |
| 异步任务样例 | `llm_video_tasks` 表 + 仓储 | [db/schema.ts:67](../../src/server/db/schema.ts) |
| Skills | `SkillRunner` 抽象（http-api/js-function/prompt-template） | [server/skills/types.ts](../../src/server/skills/types.ts) |
| 图像工具 | `image_gen` 工具（内部） | [server/tools/image-gen.ts](../../src/server/tools/image-gen.ts) |

**关键结论**：后端出图内核已存在，主要缺口是 ①对外 HTTP 路由 ②Provider 适配器可扩展化 ③参数化配置（比例/风格）④独立三栏页面与状态 ⑤会话/出图持久化与本地图库。

---

## 3. 总体架构

```
┌────────────────────────── Renderer (React + Zustand) ──────────────────────────┐
│  ImageStudioPage (三栏)                                                          │
│  ├─ ImageSessionList   ├─ ImageChatPanel                ├─ TemplateGallery       │
│  │  (左)               │  ├─ MessageStream (出图卡)      │  (右, 做同款)          │
│  │                     │  └─ ImageComposer               │                       │
│  │                     │     ├─ ModelPicker (参考图1)                            │
│  │                     │     ├─ AspectRatioPicker (参考图2)                       │
│  │                     │     ├─ StylePicker (参考图3)                             │
│  │                     │     └─ ReferenceImageInput                              │
│  useImageStore（会话/消息/参数/生成态）                                            │
│  platform.image.*（API 封装）                                                    │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                     │ HTTP (Hono, API_BASE)
┌───────────────────────────────────▼─────────────────────────────────────────────┐
│  Server (Hono + Mastra + Drizzle/SQLite)                                          │
│  routes/images.ts                                                                 │
│   POST /images            (同步：生成→落地→入库→返回)                              │
│   POST /images/tasks      (异步：创建任务)   GET /images/tasks/:id (轮询)          │
│   GET  /image-sessions … /messages  (会话/消息 CRUD)                              │
│         │                                                                         │
│  services/image-studio.service.ts  ── 编排：解析参数 → 调 Provider → 落地 → 持久化 │
│         │                          （可选）ImageAgent 提示词优化 (Mastra)          │
│  llm/media/image.ts  →  ImageProvider 适配器注册表                                 │
│   ├ openai (dall-e-3 / gpt-image-1)   ├ agnes    ├ gemini                          │
│   ├ ollama                            ├ oai-compat 图像网关 (flux/qwen)  ├ mj(异步)│
│         │                                                                         │
│  shared/image-gen.ts  (ASPECT_RATIOS / IMAGE_STYLES / IMAGE_MODEL_CAPS)  ←前后端共享│
│  db: image_generations (+ 复用 sessions/messages 或 image_sessions)               │
│  media store: <appData>/images/…                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 共享配置层（单一数据源）

新增 [`src/shared/image-gen.ts`](../../src/shared/image-gen.ts)，前端渲染下拉、后端解析参数，二者永不漂移（对齐 `writing.ts` 做法）。

```ts
// src/shared/image-gen.ts

/** 比例：值 + 语义标签 + 出图尺寸（默认，Provider 可再夹取到其支持范围）。 */
export interface AspectRatioDef {
  id: string          // '1:1' | '2:3' | ...
  label: string       // '1:1'
  hint: string        // '正方形，头像'
  size: string        // '1024x1024'（provider 通用 WxH）
  orientation: 'square' | 'portrait' | 'landscape'
}

export const ASPECT_RATIOS: AspectRatioDef[] = [
  { id: '1:1',  label: '1:1',  hint: '正方形，头像',   size: '1024x1024', orientation: 'square' },
  { id: '2:3',  label: '2:3',  hint: '社交媒体，自拍', size: '832x1248',  orientation: 'portrait' },
  { id: '3:4',  label: '3:4',  hint: '经典比例，拍照', size: '896x1152',  orientation: 'portrait' },
  { id: '4:3',  label: '4:3',  hint: '文章配图，插画', size: '1152x896',  orientation: 'landscape' },
  { id: '9:16', label: '9:16', hint: '手机壁纸，人像', size: '768x1344',  orientation: 'portrait' },
  { id: '16:9', label: '16:9', hint: '桌面壁纸，风景', size: '1344x768',  orientation: 'landscape' },
]
export const DEFAULT_ASPECT_RATIO = '1:1'

/** 风格：映射到提示词增强后缀（也可含 negativePrompt）。 */
export interface ImageStyleDef {
  id: string
  label: string        // '油画'
  promptSuffix: string // ', oil painting, textured brush strokes, rich color, classical art'
  thumb?: string       // 缩略图资源标识
}

export const IMAGE_STYLES: ImageStyleDef[] = [
  { id: 'portrait-photo', label: '人像摄影', promptSuffix: ', portrait photography, 85mm, soft light, shallow depth of field' },
  { id: 'cinematic',      label: '电影写真', promptSuffix: ', cinematic, film still, dramatic lighting, color grading' },
  { id: 'chinese',        label: '中国风',   promptSuffix: ', Chinese traditional style, ink and elegant composition' },
  { id: 'anime',          label: '动漫',     promptSuffix: ', anime style, clean lineart, cel shading' },
  { id: '3d',             label: '3D 渲染',  promptSuffix: ', 3D render, octane, physically based, high detail' },
  { id: 'cyberpunk',      label: '赛博朋克', promptSuffix: ', cyberpunk, neon lights, rainy night, high contrast' },
  { id: 'cg',             label: 'CG 动画',  promptSuffix: ', CG animation, Pixar-like, stylized, vivid' },
  { id: 'ink',            label: '水墨画',   promptSuffix: ', Chinese ink wash painting, minimal, negative space' },
  { id: 'oil',            label: '油画',     promptSuffix: ', oil painting, textured brush strokes, rich color' },
  { id: 'classical',      label: '古典',     promptSuffix: ', classical painting, renaissance, museum quality' },
  { id: 'watercolor',     label: '水彩画',   promptSuffix: ', watercolor, soft gradient, wet-on-wet' },
  { id: 'cartoon',        label: '卡通',     promptSuffix: ', cartoon, flat color, bold outline, playful' },
]

/** 图像模型能力（补充 DB 的 modality，用于 UI 徽标与能力开关）。 */
export interface ImageModelCap {
  supportsImg2Img: boolean
  async: boolean       // Midjourney 类
  local: boolean       // Ollama
}
export const IMAGE_MODEL_CAPS: Record<string, Partial<ImageModelCap>> = {
  'agnes-image-2.1-flash': { supportsImg2Img: true },
  'dall-e-3':              { supportsImg2Img: false },
  'gpt-image-1':           { supportsImg2Img: true },
  'midjourney':            { supportsImg2Img: true, async: true },
  // ollama 本地模型运行时按名称判定 local: true
}

export function getAspectRatio(id: string) { return ASPECT_RATIOS.find(a => a.id === id) }
export function getImageStyle(id: string)  { return IMAGE_STYLES.find(s => s.id === id) }
```

> 模型能力也可选择存入 `llm_models.capabilities_json`（现成字段），以便设置页可编辑；`IMAGE_MODEL_CAPS` 作为内置默认。二选一或叠加，建议：DB 优先，shared 兜底。

**参数解析规则**（服务端，driven by 上表）

1. `aspectRatioId` → `ASPECT_RATIOS[].size` → Provider 的 `size`（不支持自定义尺寸的 Provider，取最接近的官方枚举）。
2. `styleId` → 追加 `promptSuffix` 到用户 prompt 末尾（不覆盖用户原文）。
3. `referenceImages[]` → Provider 的 `image[]`（图生图）。

---

## 5. 后端设计

### 5.1 Provider 适配器抽象

把现有 `generateImage()` 的 `if provider.id === ...` 分发重构为**注册表 + 适配器**，便于逐个接入新模型。

```ts
// src/server/llm/media/image-providers/types.ts
export interface ImageProviderAdapter {
  id: string                        // 'openai' | 'agnes' | 'gemini' | 'ollama' | 'oai-compat' | 'midjourney'
  mode: 'sync' | 'async'
  generate(req: ResolvedImageGenerationRequest): Promise<ImageGenerationResult>
  // 仅 async：
  createTask?(req: ResolvedImageGenerationRequest): Promise<ImageTaskResult>
  getTask?(taskId: string): Promise<ImageTaskResult>
}
```

- 现有 `generateOpenAIImage` / `generateAgnesImage` 平移为 `openai` / `agnes` 适配器（零行为变化，仅搬家 + 注册）。
- 新增适配器逐步落地：
  - `gemini`：Gemini image REST（nano-banana 2）。
  - `ollama`：本地 `http://127.0.0.1:11434` 图像接口（按模型判断可用）。
  - `oai-compat`：OpenAI 兼容图像网关（fal / replicate / openrouter），承载 `flux` / `qwen-image`——复用 provider 的 `base_url` + key。
  - `midjourney`：`mode:'async'`，走第三方代理网关，`createTask`/`getTask` + 进度。
- 路由分发：优先用 `provider.kind`/`provider.id` + 模型元数据决定适配器；`generateImage()` 保留为对外统一入口。

**扩展 `ImageGenerationRequest`**（[llm/types.ts](../../src/server/llm/types.ts)，向后兼容，均为可选）：

```ts
export type ImageGenerationRequest = {
  model: string
  prompt: string
  size?: string
  quality?: string
  image?: string | string[]            // 参考图（图生图）
  responseFormat?: 'url' | 'b64_json'
  saveTo?: string
  // 新增：
  negativePrompt?: string
  seed?: number
  n?: number                            // v1 固定 1
  // 结构化参数（服务端解析为上面的具体值；也允许直接传 size 覆盖）
  aspectRatioId?: string
  styleId?: string
}
```

服务端在进入适配器前，用 `@shared/image-gen.ts` 把 `aspectRatioId → size`、`styleId → prompt += suffix`。

### 5.2 编排服务

```ts
// src/server/services/image-studio.service.ts
async function generateForSession(input: {
  sessionId: string
  prompt: string
  model: string
  aspectRatioId?: string
  styleId?: string
  referenceImages?: string[]           // Data URI 或 URL
  optimizePrompt?: boolean             // P1: ImageAgent 优化
}): Promise<ImageGenerationRecord>
```

步骤：
1. （可选）`ImageAgent` 优化提示词（Mastra agent，见 5.5）。
2. 解析结构化参数（比例/风格）→ 组装 `ImageGenerationRequest`。
3. 调 `generateImage()`（同步）或创建异步任务。
4. 结果落地本地图库（复用 `saveGeneratedImage`），写 `image_generations`。
5. 写一条 `messages`（role=assistant，`parts` 内含出图卡数据 → 复用现有「parts 存 UI 片段」机制）。
6. 返回记录给前端渲染结果卡。

### 5.3 HTTP 路由

新增 [`src/server/http/routes/images.ts`](../../src/server/http/routes/images.ts)（挂载到 `/` 或 `/llm`，与 `/llm/videos` 对称）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/images` | 同步生成：body `{ sessionId, prompt, model, aspectRatioId?, styleId?, referenceImages?, negativePrompt?, seed? }` → 返回出图记录 |
| POST | `/images/tasks` | 异步创建（Midjourney 等）→ 返回 taskId + 初始状态 |
| GET  | `/images/tasks/:id` | 轮询异步任务进度/结果 |
| GET  | `/image-sessions` | 画图会话列表 |
| POST | `/image-sessions` | 新建会话 |
| PATCH/DELETE | `/image-sessions/:id` | 重命名 / 删除 |
| GET  | `/image-sessions/:id/messages` | 会话消息（含出图卡） |
| GET  | `/image-templates` | 模板列表（seed，支持分类过滤） |

校验沿用 `readJson` + 手写校验（与 `llm.ts` 一致），或引入 zod（`@shared/schemas`）。错误结构复用 `{ error: { code, message } }`。

### 5.4 数据模型与持久化

**方案取舍（会话/消息）**

- 方案 A（推荐 v1）：**新增 `image_sessions` / 复用 `messages`**——画图会话与聊天会话解耦，避免污染现有 Chat 查询；`messages.session_id` 指向 image_session，出图卡放 `messages.parts`。
- 方案 B：复用 `sessions` 加 `type` 字段区分——改动小但需要给现有查询加过滤，回归面更大。

采用方案 A。新增两张表：

```ts
// db/schema.ts 追加
export const image_sessions = sqliteTable('image_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('新画图'),
  default_model: text('default_model'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const image_generations = sqliteTable('image_generations', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  message_id: text('message_id'),          // 关联的出图消息
  prompt: text('prompt').notNull(),
  resolved_prompt: text('resolved_prompt'),// 加风格后缀 / Agent 优化后的最终 prompt
  provider_id: text('provider_id').notNull(),
  model: text('model').notNull(),
  aspect_ratio: text('aspect_ratio'),
  style: text('style'),
  size: text('size'),
  seed: integer('seed'),
  reference_images: text('reference_images'),// JSON: string[]
  status: text('status').notNull(),          // 'queued'|'in_progress'|'completed'|'failed'
  provider_task_id: text('provider_task_id'),// 异步
  progress: integer('progress'),
  url: text('url'),
  local_path: text('local_path'),
  error_msg: text('error_msg'),
  duration_ms: integer('duration_ms'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (t) => ({ sessionIdx: index('idx_image_gen_session').on(t.session_id, t.created_at) }))
```

复用现有 `messages` 表存对话（含出图卡 parts）。异步任务直接复用 `image_generations.status/progress/provider_task_id`（无需再造 task 表）。

新增仓储 `image-session.repo.ts` / `image-generation.repo.ts`（对齐 `session.repo.ts` / `message.repo.ts` 写法）。迁移：现有用 `db/client.ts` seed + drizzle；新增表加建表语句 + seed 模板数据。

**本地图库**：图片默认保存到 `<appData>/bloomai/images/<sessionId>/<genId>.png`（`db/paths.ts` 已有数据目录约定，扩展一个 images 子目录）。**目录可配置**：新增 settings 键 `image_output_dir`（空=默认应用数据目录），设置页可改；service 落地时读取该键解析根目录（复用 `saveGeneratedImage` 的 `~`/绝对路径解析）。渲染端读取：
- 优先返回可访问 URL（Electron 可用自定义协议 / 本地静态路由 `GET /media/images/:file`）。
- 或直接返回 b64（小图/兜底）。建议：落地文件 + 提供 `/media` 静态读取路由，避免大 b64 进 store。

### 5.5 ImageAgent（提示词优化，默认开启）

对齐 writer-agent 的 config-driven 做法（[writer-prompt.ts](../../src/server/mastra/agents/writer-prompt.ts)）：一个轻量 Mastra Agent 负责**提示词优化/翻译/结构化**（按 Agnes 推荐结构 `[主体]+[场景]+[风格]+[光照]+[构图]+[质量]`）。

- **默认开启**：`generateForSession` 的 `optimizePrompt` 默认为 `true`；前端 Composer 提供开关，用户可关闭。
- **可关闭时的行为**：`optimizePrompt=false` 走原文（仅追加风格后缀），跳过 Agent。
- **落库**：优化后的最终提示词写入 `image_generations.resolved_prompt`，结果卡展示，便于用户「做同款」时看到真实提示词。
- **失败降级**：Agent 优化异常时回退到「原文 + 风格后缀」，不阻断出图。
- v1（M2）即接入该 Agent（非 P1）。

### 5.6 模型 seed 扩展

在 [`db/client.ts` seedLlm](../../src/server/db/client.ts:201) 追加 image 模型（provider 已有 openai/agnes/ollama，新增 gemini / 图像网关 provider）：

```
['gpt-image-1', 'openai', 'gpt-image-1', 'GPT Image', 'image', 15]
['gemini-nano-banana-2', 'gemini', 'gemini-2.x-image', 'Gemini Nano-Banana 2', 'image', 25]
['flux.1-pro', 'oai-compat-image', 'flux.1-pro', 'Flux.1 Pro', 'image', 30]
['qwen-image', 'oai-compat-image', 'qwen-image', 'Qwen-Image', 'image', 35]
['midjourney', 'midjourney', 'midjourney', 'Midjourney', 'image', 40]
```

Provider 新增（同 seed 数组）：`gemini`、`oai-compat-image`（承载 flux/qwen 的网关 base_url+key）、`midjourney`。API Key 走现有 `settings` + `.env`（`PROVIDER_API_KEY_ENV` 映射补齐，见 [llm.ts:11](../../src/server/http/routes/llm.ts)）。

---

## 6. 前端设计

### 6.1 页面注册（沿用既有模式）

1. `useUIStore.activePage` 联合类型增加 `'image'`（[store/index.ts:247](../../src/renderer/store/index.ts)）。
2. `NavSidebar` items 增加一项：`{ id: 'image', icon: ImageIcon, label: 'AI 画图' }`（`lucide-react` 的 `Image`/`Wand2`）。
3. `App.tsx` 增加分支：`activePage === 'image' && <ImageStudioPage />`。

### 6.2 组件结构

```
src/renderer/pages/ImageStudio/
├── index.tsx                 // ImageStudioPage：三栏容器
├── ImageSessionList.tsx      // 左栏（复用 SessionList 交互/样式）
├── ImageChatPanel.tsx        // 中栏：消息流 + Composer
├── ImageComposer.tsx         // 输入区 + 工具栏 chips + 生成
├── parts/
│   ├── ModelPicker.tsx       // 模型下拉（参考图1）
│   ├── AspectRatioPicker.tsx // 比例下拉（参考图2）
│   ├── StylePicker.tsx       // 风格下拉（参考图3）
│   ├── ReferenceImageInput.tsx// 参考图上传/粘贴/拖拽
│   ├── GenerationCard.tsx    // 出图结果卡（含操作）
│   └── Lightbox.tsx          // 查看大图
└── TemplateGallery.tsx       // 右栏模板 + 做同款
```

- 下拉菜单复用 Chat Composer 已有的 chip/菜单样式（参考截图即当前 Chat 工具栏样式），从 `global.css` 抽取/新增 `.image-studio-*` 类。
- 比例/风格/模型下拉直接 `map` `@shared/image-gen.ts` 与 `useLlmStore.imageModels`——**加新比例/风格只改配置表**。

### 6.3 状态管理

新增 `useImageStore`（zustand，风格对齐现有 store）：

```ts
interface ImageStudioState {
  sessions: ImageSession[]
  activeSessionId: string | null
  messagesBySession: Record<string, ImageMessage[]>   // 含出图卡
  composer: {
    prompt: string
    model: string            // 默认取 imageModels[0] / 记忆值
    aspectRatioId: string    // DEFAULT_ASPECT_RATIO
    styleId: string | null
    referenceImages: string[]// Data URI
  }
  generating: Record<string, boolean> // by sessionId 或 genId
}
interface ImageStudioActions {
  loadSessions / createSession / setActiveSession / deleteSession / rename
  loadMessages(sessionId)
  setComposer(patch)
  applyTemplate(t)                    // 做同款：回填 prompt + 推荐参数
  generate()                          // 组装请求 → 乐观插入占位卡 → 调 API → 替换结果卡
  pollTask(genId)                     // 异步进度
  addReferenceFromGeneration(genId)   // 设为参考图
}
```

- 复用现有 `useLlmStore.loadModels()`（已加载 `imageModels`）。
- 生成流程乐观更新：先插入用户消息 + loading 占位卡，成功后替换为 `GenerationCard`。
- 参数记忆（P1）：`composer` 关键字段持久化到 settings 或 localStorage。

### 6.4 API 封装

`src/renderer/api/index.ts` 的 `platform` 增加：

```ts
image: {
  listSessions() / createSession() / renameSession() / deleteSession()
  listMessages(sessionId)
  listTemplates(category?)
  generate(payload)                 // POST /images（同步）
  createTask(payload) / getTask(id)  // 异步
}
```

出图返回体包含图片可访问 URL（`/media/images/...`）或 b64；前端优先用 URL。

### 6.5 「做同款」交互

- `TemplateGallery` 卡片「做同款」→ `applyTemplate(t)`：`setComposer({ prompt: t.prompt, model: t.model ?? cur, aspectRatioId: t.ratio ?? cur, styleId: t.style ?? cur })` 并聚焦输入框；输入框非空时弹「替换/追加」。
- 出图卡「做同款」→ 用该记录的 prompt+参数回填。

---

## 7. 模板系统

v1 内置模板（seed，返回自 `/image-templates`）：

```ts
export interface ImageTemplateDef {
  id: string
  title: string
  category: string          // '人像'|'风景'|'二次元'|'商业'|'壁纸'|'国风'
  tags: string[]
  thumb: string             // 缩略图（打包内置资源）
  prompt: string            // 完整提示词
  recommend?: { model?: string; ratioId?: string; styleId?: string }
}
```

- 缩略图作为静态资源随包发布；模板数据可放 `@shared/image-templates.ts`（前后端共享）或 seed 入表。建议 `@shared` 常量（无需写库、随版本演进）。
- 未来第三方 Skills 可向模板画廊注入模板（见 §9）。

---

## 8. 异步任务（Midjourney 类）

- `POST /images/tasks` 创建 → `image_generations.status='queued'` + `provider_task_id`。
- 前端 `pollTask(genId)` 定时 `GET /images/tasks/:id` 直到 `completed/failed`；占位卡显示 `progress%`。
- 适配器 `midjourney.createTask/getTask` 对接第三方代理网关；完成后同 §5.2 落地入库。
- 与现有 `video` 的「创建+轮询」范式一致（[llm.ts:131](../../src/server/http/routes/llm.ts)），可直接借鉴 `llm_video_tasks` 仓储写法。

---

## 9. 第三方 Skills 画图（P2，仅预留）

- 复用 `skills` 表 + `SkillRunner`（http-api / js-function）：一个「image skill」约定 `input:{prompt,size,...}`、`output:{url|b64}`。
- 在 Provider 适配器层新增 `skill` 适配器：`model` 指向某 `skillId`，`generate()` 内部走 `runSkill()`，输出规范化为 `ImageGenerationResult`。
- 模板画廊 / 模型下拉可展示「来自 Skill」的能力。v1 不实现 UI，仅保证适配器接口能容纳。

---

## 10. 安全、性能与边界

- **API Key**：沿用 `settings` + `.env`（`config.ts`），前端只知 `hasApiKey`，密钥不下发。
- **参考图体积**：前端限制大小/类型，超限压缩；大图优先走文件而非 b64 入库/入 store。
- **超时**：图像生成 60~360s（见 Agnes 文档），fetch 设合理超时 + 明确失败态。
- **落地清理**：设置页提供图库大小查看 / 清理入口（P1）。
- **并发**：同一会话允许多张排队；生成态按 genId 管理，避免相互覆盖。
- **失败透传**：Provider 错误 message 透传到结果卡（复用 `LlmProviderError`）。

---

## 11. 测试策略

沿用 vitest（现有 `image.test.ts` / `video.test.ts` / `llm.repo.test.ts` 范式）：

- **单元**：`@shared/image-gen.ts` 解析（比例→尺寸、风格→后缀）；各 Provider 适配器请求体组装（mock fetch）。
- **仓储**：`image-session.repo` / `image-generation.repo` CRUD。
- **路由**：`/images` 校验 + 成功/失败路径（mock service）。
- **前端**：`useImageStore.generate` 乐观更新与替换；`applyTemplate` 回填；Picker 由配置表渲染项数正确。
- **回归**：不改动 Chat/现有 image tool 行为（适配器平移零行为变化）。

---

## 12. 实施计划（对应 PRD 里程碑）

| 里程碑 | 后端 | 前端 | 数据 |
|--------|------|------|------|
| M1 骨架 | `activePage='image'` 无需后端 | 页面注册 + 三栏 + 空态 + 会话列表壳 | — |
| M2 出图闭环 | Provider 适配器抽象（openai/agnes 平移）+ `POST /images` + service + 参数解析 + **ImageAgent 优化（默认开）** | Composer + 三个 Picker + 智能优化开关 + 结果卡 + useImageStore.generate | `image_sessions`/`image_generations` 表 + 仓储 + media 落地 + `/media` 路由 |
| M3 参考图+模板 | 参考图 **Data URI 直传** `image[]` + `/image-templates` | ReferenceImageInput + TemplateGallery + 做同款 | 内置模板常量/seed |
| M4 扩展模型 | gemini/ollama/oai-compat/gpt-image 适配器 + seed | 模型下拉能力徽标/置灰 | 模型 seed |
| M5 异步 & 记忆 | midjourney 异步任务 | 进度占位卡 + 参数记忆 | status/progress 复用 |
| M6 预留 | skill 适配器接口 | —（预留） | — |

**首个可交付切片（M1+M2）** 即可完成「Agnes/DALL·E 3 文生图 + 比例/风格 + 结果卡 + 会话持久化」的端到端闭环。

---

## 13. 附：改动清单（Checklist）

**新增**
- `src/shared/image-gen.ts`、`src/shared/image-templates.ts`
- `src/server/llm/media/image-providers/*`（types + 各适配器 + registry）
- `src/server/services/image-studio.service.ts`
- `src/server/http/routes/images.ts`
- `src/server/db/repositories/image-session.repo.ts`、`image-generation.repo.ts`
- `src/renderer/pages/ImageStudio/*`
- `useImageStore`（store/index.ts 或独立文件）

**修改**
- `src/server/llm/types.ts`（扩展 `ImageGenerationRequest`）
- `src/server/llm/media/image.ts`（改为适配器分发，保留对外入口）
- `src/server/db/schema.ts`（两张新表）+ `db/client.ts`（建表/seed 模型/provider）
- `src/server/http`（挂载 images 路由 + `/media` 静态）
- `src/renderer/store/index.ts`（`activePage` 增加 `'image'`）
- `src/renderer/components/layout/NavSidebar.tsx`（新增导航项）
- `src/renderer/App.tsx`（新增页面分支）
- `src/renderer/api/index.ts`（`platform.image.*`）
- `src/renderer/styles/global.css`（`.image-studio-*`）
