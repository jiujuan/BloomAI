# BloomAI 记忆系统设计

## 背景：现有架构的问题

BloomAI 原始 chat 链路中，`useChat` 持有全量消息数组，每次发送时把**所有历史**一次性发给 LLM：

```
用户发消息 → 客户端 body.messages（全量历史） → handleChatStream → LLM
```

这带来 4 个问题：

| 问题 | 根因 |
|---|---|
| context 越来越长 | 历史线性增长，无任何裁剪 |
| LLM 注意力分散 | context 中充斥大量早期无关对话 |
| 关键信息跨 session 丢失 | 换一个 session，之前记住的用户偏好全部丢失 |
| Summary 丢失关键信息 | 简单摘要会合并/忽略细节，无结构保证 |

---

## 解决方案：两层 Mastra Memory

引入 Mastra 的两个记忆系统，与现有 SQLite 存储**分工配合**：

### Working Memory（工作记忆）

**是什么**：LLM 维护的一份结构化"便签"，保存用户偏好、关键事实、当前目标。每次对话时自动注入到 system prompt。LLM 通过轻量工具调用来更新它，采用 merge 语义（只需返回变更字段，已有字段自动保留）。

**解决什么问题**：跨 session 关键信息丢失。用户在 session A 说"我是 Python 高级工程师，请用中文回复"，Working Memory 记住这一点，session B 开始时 LLM 已知晓，无需重复告知。

**scope**：`resource`（跨所有 session 共享），因为 BloomAI 是本地单用户应用。

### Observational Memory（观察记忆）

**是什么**：分层压缩流水线。当会话消息的 token 数超过阈值，Observer 将旧消息压缩为结构化 observation；Reflector 进一步将多个 observation 提炼为 reflection。只有最近 N 条消息 + 压缩后的 observation 进入 LLM context。

**解决什么问题**：context 越来越长 + LLM 注意力分散。旧消息不再直接喂给 LLM，而是以压缩形式存在。在 LongMemEval 基准测试中准确率达 **94.87%**，显著优于简单摘要（summary 会丢失细节）。

**scope**：`thread`（每个 session 独立压缩），避免跨 session 观察互相干扰。

---

## 与现有 SQLite 存储的关系

两套存储各司其职，互不替代：

```
                ┌─────────────────────────────────────────┐
                │  messageRepo  (现有 bloomai.db)          │
                │                                         │
                │  存储：完整 UI parts                     │
                │  ├─ text parts                          │
                │  ├─ tool 卡片 (ToolGroupCard)           │
                │  ├─ reasoning parts                     │
                │  ├─ workflow steps                      │
                │  └─ data-plan / data-attachments        │
                │                                         │
                │  用途：前端重载时重建聊天界面             │
                └──────────────────┬──────────────────────┘
                                   │ platform.getMessages()
                                   │ → useChat 内存（渲染用）
                                   ▼
                              前端聊天 UI

                ┌─────────────────────────────────────────┐
                │  Mastra Memory  (MEMORY_DATA_DIR/memory.db) │
                │                                         │
                │  ┌───────────────────────────────────┐  │
                │  │  Working Memory (resource scope)   │  │
                │  │  用户偏好 / 关键事实 / 当前目标     │  │
                │  │  → 注入 system prompt               │  │
                │  └───────────────────────────────────┘  │
                │                                         │
                │  ┌───────────────────────────────────┐  │
                │  │  Message History (thread scope)    │  │
                │  │  最近 N 条消息（lastMessages = 20） │  │
                │  │  → 直接进入 LLM context            │  │
                │  └───────────────────────────────────┘  │
                │                                         │
                │  ┌───────────────────────────────────┐  │
                │  │  Observational Memory (thread)     │  │
                │  │  旧消息 → observations → reflections│  │
                │  │  → 压缩形式进入 LLM context        │  │
                │  └───────────────────────────────────┘  │
                │                                         │
                │  用途：LLM context 管理                  │
                └─────────────────────────────────────────┘
```

**关键区别**：

- `messageRepo` 存的是**渲染数据**（工具卡片 JSON、reasoning 文本），LLM 从不直接读它
- Mastra Memory 存的是**语义数据**（消息内容 + 压缩观察），专为 LLM context 优化

---

## 完整 chat 链路（引入 Memory 后）

```
① 用户输入消息，点击发送

② 客户端 handleSend()
   └─ sendMessage({ parts })
      └─ DefaultChatTransport → POST /api/v1/chat
         body: { messages, sessionId, plan, attachments }
         header: x-bloom-mode / x-bloom-model / x-bloom-session

③ 服务端 chat.ts
   ├─ persistUserMessage()  → messageRepo.save()  ← 持久化 UI parts（流式前）
   └─ 路由判断：
      ├─ teamAgentId 存在（研究/写作/编码）→ 全量 messages，无 Memory，行为不变
      └─ 主 chat agent →
           useMemory = true
           agentMessages = [body.messages.at(-1)]  ← 只取最后一条用户消息
           withPlan / withAttachment augmentation 施加在这一条上
           handleChatStream({ threadId: sessionId, resourceId: 'bloomai-local-user', ... })

④ Mastra Memory 介入（threadId + resourceId 触发）
   ├─ 将新用户消息存入 memory.db (thread: sessionId)
   ├─ 加载 Working Memory → 附加到 system prompt
   ├─ 加载最近 20 条消息 → 放入 context
   ├─ 若旧消息超过 token 阈值 → Observer 压缩为 observations
   └─ 最终 LLM context = system + working_memory + observations + last_20_msgs + new_msg

⑤ LLM 生成响应，流式返回

⑥ Mastra Memory 自动保存 assistant 消息 → memory.db

⑦ 前端 useChat onFinish
   └─ platform.saveAssistantMessage({ parts: slimParts(parts) })
      → POST /api/v1/chat/assistant
      → messageRepo.save()  ← 持久化完整 UI parts（含工具卡片）
```

---

## 代码实现

### 新增文件：`src/server/mastra/memory.ts`

核心配置：

```typescript
export const chatMemory = new Memory({
  storage: new LibSQLStore({ config: { url: memoryDbUrl } }),
  options: {
    lastMessages,                          // 默认 20，可配置
    workingMemory: {
      enabled: true,
      scope: 'resource',                   // 跨 session 共享
      schema: workingMemorySchema,         // Zod schema，LLM 按字段更新
    },
    observationalMemory: {                 // 有 API key 时自动启用
      model: observationModel,            // auto-detect: Anthropic → OpenAI → Google
      scope: 'thread',                    // 每个 session 独立
      retrieval: true,                    // 启用 recall 工具，无需向量数据库
    },
  },
})
```

**Working Memory schema（LLM 维护的结构化状态）**：

```typescript
const workingMemorySchema = z.object({
  language:             z.string().optional(),   // 用户偏好语言
  communicationStyle:   z.string().optional(),   // 沟通风格
  expertiseLevel:       z.string().optional(),   // 领域专业程度
  keyFacts:             z.array(z.string()).optional(), // 关键事实
  currentGoals:         z.array(z.string()).optional(), // 当前目标
  importantContext:     z.string().optional(),   // 重要背景
})
```

### 修改：`src/server/mastra/chat-agent.ts`

```typescript
export const chatAgent = new Agent({
  id: 'chat',
  // ...
  memory: chatMemory,   // ← 新增
})
```

### 修改：`src/server/http/routes/chat.ts`

```typescript
const useMemory = !teamAgentId   // team agent 不走 Memory

let agentMessages: any[]
if (useMemory) {
  const newMsg = body.messages?.at?.(-1)  // 只取最新一条
  const singleArr = newMsg ? [newMsg] : []
  agentMessages = /* plan + attachment augmentation on singleArr */
} else {
  agentMessages = /* 原有全量 messages 逻辑 */
}

handleChatStream({
  params: {
    messages: agentMessages,
    ...(useMemory ? { threadId: sessionId, resourceId: BLOOMAI_RESOURCE_ID } : {}),
    // ...
  }
})
```

---

## 配置（.env）

```ini
# Memory 数据库存储目录（memory.db 会创建在这里）
MEMORY_DATA_DIR=~/.bloomai/memory

# LLM context 中直接保留的最近消息数，超出部分由 Observational Memory 处理
MEMORY_LAST_MESSAGES=20

# Observational Memory 使用的模型（Mastra router 格式）
# 留空 = 自动从已有 API key 中选最便宜的 provider：
#   ANTHROPIC_API_KEY → anthropic/claude-haiku-4-5-20251001
#   OPENAI_API_KEY    → openai/gpt-4o-mini
#   GOOGLE_API_KEY    → google/gemini-2.5-flash
#   三者都没有         → 仅启用 Working Memory，Observational Memory 禁用
MEMORY_OBSERVATION_MODEL=
```

---

## 安装依赖

```bash
npm install @mastra/memory @mastra/libsql
```

---

## 各问题的解决对照

| 原始问题 | 解决机制 | 原理 |
|---|---|---|
| context 越来越长 | `lastMessages: 20` + Observational Memory | 旧消息压缩为 observations，不再全量进入 context window |
| LLM 注意力分散 | context 有界（20 条 + observations） | LLM 聚焦于近期对话，避免早期噪声干扰 |
| 关键信息跨 session 丢失 | Working Memory（resource scope） | 用户偏好/目标以结构化形式持久保存，新 session 自动注入 |
| Summary 丢失关键信息 | Observational Memory（分层压缩） | Observer → Reflector 分两层，LongMemEval 准确率 94.87%，远优于简单摘要 |

---

## 注意事项

### 历史 session 兼容性

引入 Memory 后，**已有 session 的历史消息不会迁移到 memory.db**。对于这些 session：

- 前端 UI 加载不受影响（依然从 `messageRepo` 读取，显示完整历史）
- LLM context 从该 session 首次使用 Memory 后开始积累，之前的历史对 LLM 不可见

这是预期行为。如需迁移历史消息，可手动从 `messageRepo.getHistory()` 读取并写入 Mastra Memory 的 thread。

### team agent 不受影响

`useMemory = !teamAgentId`：研究 / 写作 / 编码 team agent 继续接收全量 messages，行为与引入 Memory 前完全一致。

### Working Memory 更新时机

LLM 通过工具调用更新 Working Memory（schema-based merge 语义）。**不是每轮都更新**，只有 LLM 判断有新的重要信息需要记录时才触发。开发时可在日志中观察 `memory.update` 工具调用。

### Observational Memory 的同步模式

默认 Observational Memory 同步运行：当 token 阈值触发时，Observer 在当次请求内完成压缩，可能增加首次触发时的响应延迟（通常 1-3 秒）。Mastra 后续版本支持异步背景压缩模式，届时可升级。

---

## 参考文档

- [Working Memory | Mastra Docs](https://mastra.ai/docs/memory/working-memory)
- [Observational Memory | Mastra Docs](https://mastra.ai/docs/memory/observational-memory)
- [Announcing Observational Memory | Mastra Blog](https://mastra.ai/blog/observational-memory)
- [Memory Class Reference | Mastra Docs](https://mastra.ai/reference/memory/memory-class)
- [Memory Processors | Mastra Docs](https://mastra.ai/docs/memory/memory-processors)
