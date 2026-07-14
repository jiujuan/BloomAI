# 修复：工具步骤卡片（搜索过程等）刷新/切换会话后消失

## Context（根因）

AI 回答前调用工具（如 web_search），流式过程中 `useChat` 在内存里持有完整的
`message.parts`（`tool-*` / `reasoning` / `data-workflow` 等），由
[ChatPanelMastra.tsx](src/renderer/pages/Chat/ChatPanelMastra.tsx) 的 `renderAssistantParts`
渲染成工具卡片。卡片之所以"过几分钟后消失"，**不是定时器**，而是**会话被重新从 SQLite 加载**导致——
触发点：切到别的会话再切回、离开 Chat 页再回来、或重启应用。一旦重新加载，内存里的富 parts
就被数据库里的纯文本覆盖。

两处缺陷（已确认）：

1. **存储端只存文本** — [chat.ts](src/server/http/routes/chat.ts) 的
   `persistAssistantMessage` 只写 `content`（最终文本）+ `tool_calls = buildTrace(...)`，
   而 `buildTrace` 仅是 `{runtime, model, toolCalls:[{toolId}]}`——**只有工具名，没有
   入参/结果/链接**。富 parts 被整体丢弃。
2. **恢复端只还原文本** — [ChatPanelMastra.tsx](src/renderer/pages/Chat/ChatPanelMastra.tsx)
   加载历史时 `parts: [{ type:'text', text: m.content }]`，忽略 `tool_calls`。代码注释自己也写了
   "historical tool cards are not reconstructed"。

所以任何"重新加载会话"都会让工具卡片消失。

## 目标

持久化 AI 回答的**完整 UI parts**（工具调用入参/结果/链接、reasoning、深度研究 workflow 步骤），
使刷新 / 切换会话 / 重启后工具卡片原样恢复。大输出做**有界裁剪**，避免 SQLite 行无限膨胀。

## 方案：persist-what-you-render（持久化即所渲染）

核心思路：`useChat` 在 `onFinish` 时已经把这条 AI 消息的 `parts` 完整组装好（正是卡片渲染所用），
直接把这份 parts 存进 SQLite，加载时原样喂回 `setMessages`，渲染层零改动即可复现卡片。

确认的 API（ai@6 / @ai-sdk/react@3）：`useChat({ onFinish })` 回调签名为
`(options: { message: UIMessage; ... }) => void`，`message.parts` 即完整 parts 数组。

### 1. 数据库：messages 增加 `parts` 列（JSON 文本）
- [schema.ts](src/server/db/schema.ts)：`messages` 表加 `parts: text('parts')`（可空）。
- [client.ts](src/server/db/client.ts) `runBootstrapSql()`：现有 DB 已建表，`CREATE TABLE IF NOT
  EXISTS` 不会补列 → 追加**幂等迁移**：
  ```js
  try { rawDb.exec(`ALTER TABLE messages ADD COLUMN parts TEXT`) } catch { /* 已存在 */ }
  ```
- [message.repo.ts](src/server/db/repositories/message.repo.ts)：`Message` 类型加 `parts?: string | null`；
  `save()` 写入 `parts`；`list()`（`select()` 已返回全字段）天然带出。`getHistory()` 仍只取
  `content`（喂给 LLM 的历史用纯文本即可，不变）。

### 2. 存储端改为"客户端来源、单写入"
- **服务端**：移除 `onFinish` 里的 `persistAssistantMessage`，以及 deep-research 分支里
  `execute` 末尾的 `persistAssistantMessage(...)`（[chat.ts](src/server/http/routes/chat.ts)）。
  保留 `persistUserMessage`（请求开始即写用户消息 + 首条设标题，生成失败也不丢）。
  `buildTrace` 可删。
- **新增持久化路由** `POST /api/v1/chat/assistant`（chat.ts 内）：接收
  `{ sessionId, role:'assistant', content, parts, tokens }`，调用 `messageRepo.save(...)` 写一行。
- 单写入避免"服务端 uuid 行"与"客户端富 parts 行"重复/对账问题。
  - 权衡：若客户端恰在 onFinish 瞬间被卸载，这条 AI 消息可能不落库（用户消息已落库）。onFinish
    在流结束、parts 组装完成时同步触发，发送为 fire-and-forget，概率极低，可接受。（如需更强保证，
    后续可加服务端纯文本兜底 upsert，本次不做。）

### 3. 客户端：onFinish 持久化 + 加载还原
- [ChatPanelMastra.tsx](src/renderer/pages/Chat/ChatPanelMastra.tsx)：
  - `useChat({ onFinish: ({ message }) => { ... } })`：把
    `{ sessionId: activeSessionId, role:'assistant', content: 取 text parts 拼接, parts: slimParts(message.parts), tokens }`
    POST 到新路由（经 `platform`/`apiFetch`）。
  - 加载 effect：`parts: m.parts ? JSON.parse(m.parts) : [{ type:'text', text: m.content }]`，
    用户消息和旧数据天然回退到纯文本。解析失败也回退，不抛。
- [api/index.ts](src/renderer/api/index.ts)：加 `saveAssistantMessage(payload)` 走 `apiFetch`。

### 4. 体积控制：`slimParts()`（客户端，新建小工具或并入 tool-part.ts）
卡片实际只用到 `summarizeInput` / `summarizeOutput` / `extractResultLinks(top 3)`
（见 [tool-part.ts](src/renderer/pages/Chat/parts/tool-part.ts)），故可在存储前**无损于 UI 地**裁剪：
- `tool-*` part 的 `output.results`：只留 `{title, url, snippet?}`，最多 ~10 条；保留
  `total/provider/summary/text`，长字符串截断（如 500 字）。
- `reasoning` part：保留，长文本截断（如 4000 字）。
- 其它 part（text / data-workflow / step-start）原样保留。
- 统一对单条 part 的 JSON 体积设上限，超限再降级。

## 涉及文件
- `src/server/db/schema.ts`、`src/server/db/client.ts`、`src/server/db/repositories/message.repo.ts`
- `src/server/http/routes/chat.ts`
- `src/renderer/pages/Chat/ChatPanelMastra.tsx`、`src/renderer/api/index.ts`
- `src/renderer/pages/Chat/parts/tool-part.ts`（加 `slimParts`）

## 验证
1. `npm run typecheck` 通过。
2. `npm run dev`：发一条会触发搜索的问题 → 出现工具卡片 → **切到别的会话再切回** /
   重启应用 → 工具卡片（含搜索结果链接、状态）原样恢复，而非只剩答案文本。
3. 切「深度思考」触发 deep-research workflow，确认 `data-workflow` 步骤卡片同样可恢复。
4. 查 SQLite：`messages.parts` 有 JSON；大搜索结果行体积受 `slimParts` 约束（抽查行大小）。
5. 旧消息（无 parts 列值）仍正常显示为纯文本，不报错。
6. 如有针对 message.repo / chat 路由的单测，补充 parts 往返用例。
