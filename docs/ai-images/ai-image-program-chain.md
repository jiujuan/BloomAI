# AI画图程序链路分析

> 本文档描述 BloomAI AI画图（Image Studio）功能的完整程序链路，涉及文件、调用关系及数据流。

## 概述

AI画图**不涉及 Mastra agent**，走独立的 HTTP → Service → LLM 路径，与聊天的 Mastra agent 完全分离。

整体分为七层：页面层 → 状态层 → API Bridge → 路由层 → Service层 → LLM调用层 → 持久化层。

---

## 一、页面层（Renderer）

```
src/renderer/pages/ImageStudio/
├── index.tsx                   # 入口，三栏布局 (ImageSessionList | ImageChatPanel | TemplateGallery)
├── ImageSessionList.tsx        # 左栏：会话列表
├── ImageChatPanel.tsx          # 中栏：生成记录 + Composer
├── ImageComposer.tsx           # 输入框 + chips 工具栏（模型/比例/风格/参考图/智能优化）
├── TemplateGallery.tsx         # 右栏：模板库
└── parts/
    ├── GenerationCard.tsx      # 单条生成记录卡片（骨架/完成/失败 + 操作按钮）
    ├── ModelPicker.tsx         # 模型选择 chip
    ├── AspectRatioPicker.tsx   # 比例选择 chip
    ├── StylePicker.tsx         # 风格选择 chip
    ├── ReferenceImageInput.tsx # 参考图上传（拖拽/粘贴/点击，最多4张）
    ├── Lightbox.tsx            # 大图查看
    ├── ChipMenu.tsx            # 下拉菜单通用组件
    └── image-file.ts           # 文件 → DataURI 工具函数
```

---

## 二、状态层（Store）

```
src/renderer/store/index.ts    # useImageStore (Zustand)
```

`generate()` 核心流程：

1. 乐观插入一条 `status: 'in_progress'` 占位 record → 立即刷新 UI（显示骨架屏）
2. 调 `platform.image.generate(payload)` → HTTP POST
3. 拿到返回 record 后替换占位 record，触发 `GenerationCard` 重渲染

---

## 三、API Bridge

```
src/renderer/api/index.ts
```

```
platform.image.generate(payload)
  → apiFetch('POST /images', payload)
  → fetch('http://127.0.0.1:3718/api/v1/images', ...)
```

图片展示 URL：

```
imageMediaUrl(genId)
  → 'http://127.0.0.1:3718/api/v1/media/image/<genId>'
```

`platform.image` 包含的完整方法：

| 方法 | 说明 |
|---|---|
| `listSessions()` | 获取会话列表 |
| `createSession()` | 创建新会话 |
| `renameSession()` | 重命名会话 |
| `deleteSession()` | 删除会话 |
| `listGenerations(sessionId)` | 获取某会话的所有生成记录 |
| `listTemplates(category?)` | 获取模板库 |
| `generate(payload)` | 触发图片生成 |

---

## 四、路由层（Server HTTP）

```
src/server/http/routes/images.ts    # 挂载在 /api/v1
src/server/http/app.ts              # app.route('/api/v1', imageStudioRoutes)
```

| 路由 | 作用 |
|---|---|
| `POST /images` | 触发生成 → 调 service |
| `GET /media/image/:id` | 从磁盘读文件返回 PNG |
| `GET /image-sessions` | 会话列表 |
| `POST /image-sessions` | 创建会话 |
| `PATCH /image-sessions/:id` | 重命名会话 |
| `DELETE /image-sessions/:id` | 删除会话 |
| `GET /image-sessions/:id/generations` | 某会话的所有生成记录 |
| `GET /image-templates` | 模板库 |

---

## 五、Service 层（核心业务逻辑）

```
src/server/services/image-studio.service.ts
```

`generateForSession()` 完整流程：

```
1. resolveModel(model, 'image')        # 校验模型合法性，拿 provider
2. getAspectRatio / getImageStyle      # 解析尺寸/风格参数
3. resolveSize()                       # DALL·E 固定尺寸 vs 自由尺寸
4. optimizePrompt()（可选）             # 用文本模型扩写提示词（streamChatCompletion）
5. sanitizeReferenceImages()           # 过滤/裁剪参考图（data: / https:，最多4张）
6. imageGenerationRepo.create(...)     # DB 写入 in_progress 记录
7. generateImage({ ...saveTo })        # 调 LLM provider
8. 保存图片到磁盘（下载 URL 或 base64 写盘）
9. imageGenerationRepo.update(...)     # DB 更新为 completed / failed
10. imageSessionRepo.touch/update()   # 首次成功时自动命名会话
```

### 智能优化提示词（`optimizePrompt`）

使用当前配置的默认文本模型，通过 `streamChatCompletion` 将用户短描述扩写为：

```
[subject] + [scene/environment] + [style] + [lighting] + [composition] + [quality]
```

任何错误都会 fallback 到原始提示词，不阻断生成。

---

## 六、LLM 调用层

```
src/server/llm/media/image.ts
```

| Provider | 实现函数 | API endpoint |
|---|---|---|
| `openai` | `generateOpenAIImage()` | `{baseUrl}/images/generations` |
| `agnes` | `generateAgnesImage()` | `{baseUrl}/images/generations` |

生成结果处理：

- 返回 `url` → `saveGeneratedImage(url, saveTo)` 下载保存到本地
- 返回 `b64_json` → `saveBase64()` 直接写盘

---

## 七、持久化层

```
src/server/db/repositories/
├── image-generation.repo.ts   # 生成记录 CRUD
└── image-session.repo.ts      # 会话 CRUD

src/server/db/paths.ts         # 磁盘路径：getDataDir() / getImagesDir()
src/server/db/client.ts        # SQLite 初始化（node:sqlite + Drizzle ORM）
```

### 图片存储路径

```
~/.bloomai/images/<sessionId>/<genId>.png
```

- 默认数据目录：`~/.bloomai`（可通过 `DATA_DIR` 环境变量覆盖，支持 `~` 展开）
- 图片目录可在设置中通过 `image_output_dir` 单独覆盖

---

## 完整调用链（一次生成）

```
用户点击「生成」
  └→ ImageComposer.tsx
      └→ useImageStore.generate()          [store/index.ts]
          ├─ 插入占位 record (in_progress) → GenerationCard 显示骨架屏
          └→ platform.image.generate()     [api/index.ts]
              └→ POST /api/v1/images       [HTTP 127.0.0.1:3718]
                  └→ images.ts route
                      └→ generateForSession()   [image-studio.service.ts]
                          ├─ (可选) optimizePrompt()
                          │     └→ streamChatCompletion() → 文本模型
                          ├─ generateImage()    [llm/media/image.ts]
                          │     └→ fetch provider API (OpenAI / Agnes)
                          ├─ 下载/写入 PNG
                          │     └→ ~/.bloomai/images/<session>/<id>.png
                          └─ DB update → completed / failed
                              └→ 返回 ImageGenerationRecord
          └─ 替换占位 record → GenerationCard 渲染完成状态
              └→ <img src="http://127.0.0.1:3718/api/v1/media/image/<id>">
                  └→ GET /media/image/:id
                      └→ fs.readFileSync(local_path) → 返回 PNG bytes
```

---

## 共享类型定义

```
src/shared/image-gen.ts          # AspectRatioDef、ImageStyle、IMAGE_MODEL_CAPS 等常量
src/shared/image-templates.ts    # 模板库定义
```
