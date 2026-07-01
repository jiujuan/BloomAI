# M4 — Image Adapter Registry + New Providers + Settings Redesign

> Branch: `feat/ai-image-studio`  
> Depends on: M1-M3 (already merged to branch)

---

## 背景 / Context

M1–M3 实现了独立 AI 画图页面、文生图主流程、img2img 参考图。M4 目标：
1. 将 `generateImage()` 的 `if/else` 硬编码改为 **Adapter Registry 模式**，新增模型无需改核心分发逻辑
2. 接入新画图模型：GPT-Image-1、Flux (via Together.ai OpenAI-compatible)、Qwen-Image、Gemini Imagen、Ollama 本地
3. Settings → Models 页面改为 **左右两栏布局**：左栏大模型列表、右栏选中模型的参数配置

---

## 任务清单

### M4-1: Image Adapter Registry 重构

**目标**  
将 `src/server/llm/media/image.ts` 中的硬编码 `if (providerId === 'openai') / if (providerId === 'agnes')` 提取为 Adapter Registry 模式。

**功能**  
- 定义 `ImageProviderAdapter` 接口 `{ generate(req: ResolvedImageGenerationRequest): Promise<ImageGenerationResult> }`
- 创建 `registerImageAdapter(providerId, adapter)` + `getImageAdapter(providerId)` 注册/查找函数
- `generateImage()` 只做：resolveModel → getImageAdapter → adapter.generate；找不到 adapter 抛 `LlmUnsupportedModelError`
- 把现有 OpenAI 和 Agnes 逻辑分别提取为独立 Adapter 文件，启动时注册

**新增/修改文件**
| 文件 | 操作 |
|---|---|
| `src/server/llm/media/image-adapter-registry.ts` | 新增：接口定义 + Map 注册 |
| `src/server/llm/media/adapters/openai.adapter.ts` | 新增：迁移 `generateOpenAIImage` |
| `src/server/llm/media/adapters/agnes.adapter.ts` | 新增：迁移 `generateAgnesImage` |
| `src/server/llm/media/image.ts` | 修改：dispatcher 改为 registry 查找；`saveGeneratedImage` 保留 |

**测试策略**  
- 单元测试：mock `getImageAdapter`；验证找不到 adapter 时抛正确错误
- 回归：已有 OpenAI/Agnes 流程不变

---

### M4-2: 新 Image Provider Adapters

**目标**  
实现 5 个新画图 Provider 的 Adapter，注册到 registry。

#### M4-2a: GPT-Image-1 (OpenAI)
- Model: `gpt-image-1`，Provider: `openai`（已存在）
- **复用** `openai.adapter.ts`，只需添加 DB 模型种子
- 参数差异：gpt-image-1 支持 `quality=high/medium/low`、`output_format=png/webp/jpeg`；adapter 透传

#### M4-2b: Flux via Together.ai (OpenAI-Compatible)
- Provider: `together`，Kind: `openai-compatible`
- Base URL: `https://api.together.xyz/v1`
- API Key setting: `together_api_key`
- 新增 Adapter: `src/server/llm/media/adapters/openai-compatible-image.adapter.ts`
  - 调用 `POST {baseUrl}/images/generations`，请求体与 OpenAI 格式一致
  - 注意 Together.ai 返回 `data[0].url` 或 `data[0].b64_json`，和 OpenAI 一样
- Models seed: `black-forest-labs/FLUX.1-schnell`, `black-forest-labs/FLUX.1-dev`

#### M4-2c: Qwen-Image via DashScope (OpenAI-Compatible)
- Provider: `qwen`，Kind: `openai-compatible`
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- API Key setting: `qwen_api_key`
- **复用** `openai-compatible-image.adapter.ts`（DashScope compatible-mode 接口与 OpenAI 格式一致）
- Models seed: `wanx-v1`, `wanx-v2.1-t2i-turbo`

#### M4-2d: Gemini Imagen (Google)
- Provider: `google`，Kind: `openai-compatible`
- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
  - Google 提供 OpenAI 兼容端点，images endpoint 为 POST `/images/generations`
- API Key setting: `google_api_key`
- **复用** `openai-compatible-image.adapter.ts`
- Models seed: `imagen-3.0-generate-001`, `imagen-3.0-fast-generate-001`

#### M4-2e: Ollama (Local)
- Provider: `ollama`（已存在）
- 新增 Adapter: `src/server/llm/media/adapters/ollama-image.adapter.ts`
  - Ollama `POST /api/generate` with `{ model, prompt, stream: false }`
  - Response: `{ response: "", images: ["base64..."] }`（仅支持图像生成的模型，如 sd3.5）
  - 若响应中无 images，抛 `LlmUnsupportedModelError`（提示用户选择支持图生图的模型）
- Models seed: `sd3.5` (builtin=0，实际需用户手动 `ollama pull sd3.5`)

**新增/修改文件**
| 文件 | 操作 |
|---|---|
| `src/server/llm/media/adapters/openai-compatible-image.adapter.ts` | 新增 |
| `src/server/llm/media/adapters/gemini-image.adapter.ts` | 新增（Google openai-compat） |
| `src/server/llm/media/adapters/ollama-image.adapter.ts` | 新增 |
| `src/server/llm/media/image.ts` | 注册新 adapters at module init |

**测试策略**  
- `openai-compatible-image.adapter.test.ts`：mock fetch，验证请求体格式、b64_json fallback
- `ollama-image.adapter.test.ts`：mock fetch，验证 `images[]` 空时抛错

---

### M4-3: 新 Provider/Model DB Seeds + IMAGE_MODEL_CAPS

**目标**  
在 `client.ts` 的 `seedLlm()` 中增加新 Provider 和 Model 种子；在 `image-gen.ts` 中补全 `IMAGE_MODEL_CAPS`。

**新增 Providers**
| id | name | kind | base_url | api_key_setting_key |
|---|---|---|---|---|
| `together` | Together.ai | openai-compatible | https://api.together.xyz/v1 | together_api_key |
| `qwen` | Qwen (DashScope) | openai-compatible | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen_api_key |
| `google` | Google AI | openai-compatible | https://generativelanguage.googleapis.com/v1beta/openai | google_api_key |

**新增 Settings keys**
- `together_api_key`, `qwen_api_key`, `google_api_key`（默认空字符串）

**新增 Models**
| id | provider_id | model_id | label | modality | sort_order |
|---|---|---|---|---|---|
| gpt-image-1 | openai | gpt-image-1 | GPT-Image 1 | image | 15 |
| flux-schnell | together | black-forest-labs/FLUX.1-schnell | FLUX.1 Schnell | image | 10 |
| flux-dev | together | black-forest-labs/FLUX.1-dev | FLUX.1 Dev | image | 20 |
| wanx-v1 | qwen | wanx-v1 | Qwen Wanx v1 | image | 10 |
| wanx-v2-turbo | qwen | wanx-v2.1-t2i-turbo | Qwen Wanx v2 Turbo | image | 20 |
| imagen-3-fast | google | imagen-3.0-fast-generate-001 | Imagen 3 Fast | image | 10 |
| imagen-3 | google | imagen-3.0-generate-001 | Imagen 3 | image | 20 |
| ollama-sd35 | ollama | sd3.5 | Ollama SD3.5 (local) | image | 30 |

**IMAGE_MODEL_CAPS 新增**
```ts
'gpt-image-1': { supportsImg2Img: true },
'black-forest-labs/FLUX.1-schnell': { supportsImg2Img: false },
'black-forest-labs/FLUX.1-dev': { supportsImg2Img: true },
'wanx-v1': { supportsImg2Img: false },
'wanx-v2.1-t2i-turbo': { supportsImg2Img: false },
'imagen-3.0-generate-001': { supportsImg2Img: false },
'imagen-3.0-fast-generate-001': { supportsImg2Img: false },
'sd3.5': { supportsImg2Img: true, local: true },
```

**修改文件**
| 文件 | 操作 |
|---|---|
| `src/server/db/client.ts` | 修改 `seedLlm()` + `seedSettings()` |
| `src/shared/image-gen.ts` | 修改 `IMAGE_MODEL_CAPS` |

**测试策略**  
- `src/shared/image-gen.test.ts`：追加新模型 caps 验证

---

### M4-4: Settings → Models 页面两栏重构

**目标**  
将 Settings 的 Models tab 改为左右两栏布局，支持选中模型后在右栏编辑其参数。

**UI 设计**

```
┌─────────────────────────────────────────────────────────────┐
│  Models                                                      │
├────────────────────────┬────────────────────────────────────┤
│  [🔍 搜索模型...]       │  GPT-Image 1                       │
│                        │  OpenAI  ·  image                  │
│  ▸ Anthropic           │  ─────────────────────────────     │
│    Claude 3.5 Sonnet ✓ │  API Key                           │
│    Claude 3 Opus       │  [sk-...               ] [👁]      │
│    Claude 3 Haiku      │                                     │
│                        │  Base URL                           │
│  ▸ OpenAI              │  [https://api.openai.com/v1  ]     │
│    GPT-4o              │                                     │
│    GPT-4o mini         │  [✓] 已启用                        │
│    DALL-E 3            │  [✓] 设为默认 Image 模型            │
│  ▶ GPT-Image 1  ←selected                                   │
│                        │  [保存]                 [✓ 已保存]  │
│  ▸ Agnes               │                                     │
│    Agnes 2.0 Flash     │                                     │
│    Agnes Image 2.1     │                                     │
│                        │                                     │
│  ▸ Google AI           │                                     │
│    Imagen 3            │                                     │
│    Imagen 3 Fast       │                                     │
│                        │                                     │
│  ▸ Together.ai         │                                     │
│    FLUX.1 Schnell      │                                     │
│    FLUX.1 Dev          │                                     │
│                        │                                     │
│  ▸ Qwen                │                                     │
│    Wanx v1             │                                     │
│    Wanx v2 Turbo       │                                     │
│                        │                                     │
│  ▸ Ollama              │                                     │
│    Ollama SD3.5 (本地) │                                     │
└────────────────────────┴────────────────────────────────────┘
```

**交互流程**
1. 进入 Settings → Models tab，左栏显示全部模型列表，按 Provider 分组
2. 顶部搜索框实时过滤（label 或 modelId 匹配）
3. 点击左栏某模型 → 右栏加载该模型详情
4. 右栏可编辑：API Key（来自该 Provider 的 api_key_setting_key）、Base URL（provider 级别）
5. Enable 切换 → 调用 `PATCH /llm/models/:id { is_enabled }` 立即生效
6. "设为默认 XXX 模型" → 调用 `updateSetting('default_image_model', modelId)` 等
7. 点 [保存] → 保存 API Key 和 Base URL，显示 2s 的 "已保存" 状态

**组件结构**
```
SettingsPage (Models tab)
  ModelSettingsPanel (两栏容器)
    ModelList (左栏)
      [search input]
      [grouped by provider, each group collapsible]
      ModelListItem (点击 setSelectedModel)
    ModelDetailPanel (右栏)
      ModelDetailHeader (name, provider, modality badge)
      ApiKeyField (masked input + toggle show/hide)
      BaseUrlField (input)
      EnableToggle (switch)
      SetDefaultButton (modality-aware)
      SaveButton
```

**新增/修改文件**
| 文件 | 操作 |
|---|---|
| `src/renderer/pages/Settings/index.tsx` | 修改：Models tab 改两栏 |
| `src/renderer/styles/global.css` | 新增：`.settings-models-panel`, `.settings-model-list`, `.settings-model-detail` 等 CSS |

**测试策略**  
- 手动测试：进入 Settings → Models，点击不同模型，右栏正确显示各 provider 的 API key 状态
- 编辑 API key → Save → 重新进入该模型，显示 Saved 状态
- Enable toggle → 去 AI 画图页面，已禁用模型不出现在 ModelPicker

---

## 实施顺序

```
M4-1 (adapter registry) → M4-2 (new adapters) → M4-3 (seeds + caps) → M4-4 (settings UI)
```

1. M4-1 + M4-3 可并行（后端重构 + 数据种子）
2. M4-2 依赖 M4-1 完成后再注册新 adapters
3. M4-4 依赖 M4-3（新 provider seeds 需要出现在 UI 列表）

---

## 完成标准

- [ ] `generateImage()` 无任何 `if (providerId === '...')` 硬编码
- [ ] 8 个画图模型的 DB seed 存在（含 gpt-image-1、Flux、Qwen、Gemini、Ollama）
- [ ] Settings > Models 页面为两栏，左栏列表可搜索，右栏可编辑 API Key 和 Base URL
- [ ] `pnpm test` 全部通过（新增 adapter 单元测试）
- [ ] 冒烟测试：Agnes Image + GPT-Image-1（若有 key）正常生图

---

## 文件影响一览

```
src/
  shared/
    image-gen.ts                          (修改 IMAGE_MODEL_CAPS)
  server/
    db/
      client.ts                           (修改 seedLlm, seedSettings)
    llm/
      media/
        image.ts                          (重构 dispatcher)
        image-adapter-registry.ts         (新增)
        adapters/
          openai.adapter.ts               (新增)
          agnes.adapter.ts                (新增)
          openai-compatible-image.adapter.ts (新增)
          ollama-image.adapter.ts         (新增)
  renderer/
    pages/
      Settings/
        index.tsx                         (重构 Models tab)
    styles/
      global.css                          (新增 settings 两栏 CSS)
```
