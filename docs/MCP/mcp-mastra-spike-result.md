# Mastra MCP Client Spike 结果

- **状态**：Task 0 已通过；Task 1 及后续生产实现尚未开始
- **日期**：2026-08-09
- **用途**：本文件是当前锁定 Mastra 版本的 API、运行时和协议证据来源。它冻结 BloomAI 后续生产 Adapter 必须遵守的边界，但不表示 MCP Client 产品功能已经完成。
- **关联文档**：
  - 设计方案：`docs/MCP/2026-08-02-bloomai-mcp-client-design.md`
  - 实施计划：`docs/MCP/2026-08-02-bloomai-mcp-client-implementation-plan.md`
  - 后续路线图：`docs/MCP/mcp-roadmap.md`

---

## 1. Spike 范围和证据

Spike 使用真实的 `@mastra/mcp` Client、真实 MCP SDK Transport 和固定本地 Fixture，验证：

- 依赖精确版本、peer dependency、Node engine 和 lockfile；
- `MCPClient` 构造、Server Definition、Tool 发现和生命周期；
- `listTools()` 返回值、命名空间和远端名称映射；
- 通过返回的 Mastra Tool `execute()` 执行远端 `tools/call`；
- input/output schema、`content`、`structuredContent`、`isError` 和大结果；
- `AbortSignal`、全局 timeout、disconnect、reconnect 和 timeout 后恢复；
- 固定 stdio Fixture 和 stateful Streamable HTTP Fixture；
- Mastra HTTP 的 legacy SSE fallback 是否被静默使用。

执行入口和契约测试：

```text
scripts/mcp-spike.ts
tests/fixtures/mcp/fixture-tools.mjs
tests/fixtures/mcp/stdio-server.mjs
tests/fixtures/mcp/http-server.mjs
src/server/mcp/mastra-adapter.contract.test.ts
```

Fixture 只使用固定本地脚本和合成测试数据；结果文档不记录任何真实环境变量、Token、Authorization Header、随机 session id 或未脱敏敏感 input/output。

---

## 2. 精确版本、类型和 lockfile

| 项目 | Spike 结果 |
|---|---|
| Node 运行时 | `v24.15.0` |
| 项目 Node engine | `>=22.16.0` |
| `@mastra/core` | `1.51.0` |
| `@mastra/mcp` | `1.15.1` |
| `@mastra/mcp` peer `@mastra/core` | `>=1.0.0-0 <2.0.0-0` |
| `@mastra/mcp` Node engine | `>=22.13.0` |
| `@modelcontextprotocol/sdk` | `1.30.0` |
| npm lockfile | v3 |
| 依赖声明 | `package.json` 中使用精确版本 `"@mastra/mcp": "1.15.1"` |

`@mastra/core@1.51.0` 满足 `@mastra/mcp@1.15.1` 的 peer dependency，项目 Node engine 也满足 Mastra MCP 的最低 Node engine。本次 Spike 已执行候选版本查询，并通过 `npm install --save-exact` 更新 `package.json` 和 `package-lock.json`。

### 2.1 构造参数和 Server Definition

当前类型证据等价于：

```ts
interface MCPClientOptions {
  id?: string
  servers: Record<string, MastraMCPServerDefinition>
  timeout?: number
}

type MastraMCPServerDefinition =
  | StdioServerDefinition
  | HttpServerDefinition

new MCPClient({ id?, servers, timeout? })
```

已验证的配置要点：

- stdio 使用 `command`、参数数组 `args` 和可选 `env`；Spike 使用固定 `process.execPath` 加本地 Fixture，不通过 CI 中的任意 `npx` 下载脚本；
- HTTP 使用 `url: URL`，不能把 URL 配置成普通字符串；可配置 `requestInit`、自定义 `fetch` 和 `connectTimeout`；
- `MCPClient` 提供 `listTools()`、`disconnect()`、`reconnectServer(serverName)`；同时暴露 Resources、Prompts 等能力，但这些能力不进入一期 Tools-first 契约；
- `listTools()` 的类型是 `Promise<Record<string, Mastra Tool>>`；没有把未经验证的旧方法名当作公共 Adapter API。

---

## 3. Tool 发现、命名空间和执行路径

### 3.1 `listTools()` 返回结构

对每个配置的 Server，`listTools()` 返回一个以本地命名空间名称为 key 的 Record。Fixture 的远端工具名称为 `echo`、`structured`、`error`、`delay`、`large`，实际本地名称分别采用：

```text
<serverName>_echo
<serverName>_structured
<serverName>_error
<serverName>_delay
<serverName>_large
```

返回值中的 Mastra Tool 保留命名空间后的 `id`，并提供 description、input schema；带输出 schema 的 Tool 还提供 output schema。`remoteName` 不是直接从 `id` 猜测的业务事实，而是 Adapter 在已知 Server 命名空间前缀内维护的独立映射：

```ts
type DiscoveredMcpTool = {
  localName: string
  remoteName: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  tool: MastraTool
}
```

因此 BloomAI 本地 ID 仍然使用自己的稳定格式：

```text
mcp:{serverId}:{remoteName}
```

### 3.2 真实执行路径

Spike 固定的路径为：

```text
MCPClient.listTools()
  -> Record<namespacedName, Mastra Tool>
  -> namespaced Mastra Tool.execute(input, { abortSignal })
  -> MCP SDK tools/call
```

BloomAI Adapter 应在连接对象内缓存发现结果，根据原始 `remoteName` 找到对应的 namespaced Tool，再调用该 Tool 的 `execute()`。`src/server/mcp` 之外的代码只能依赖 BloomAI 的 `McpProviderConnection`，不能直接导入 Mastra MCP 类型或把原始 Mastra Tool 直接挂到 Agent。

---

## 4. 结果形态

Fixture 和 `onToolError: 'return'` 下观察到的结果形态如下：

| Fixture Tool | 运行时观察 | Adapter 约束 |
|---|---|---|
| `echo` | 返回 MCP result object，包含 `content` 文本块 | 保留 `content`，交给后续 `NormalizedMcpResult` 规范化 |
| `structured` | Tool 执行结果直接是结构化对象 `{ value, length }`，不是外层完整 MCP wrapper | 不把结构化对象误当作文本；Task 2 再定义统一结果模型 |
| `error` | `isError: true` 仍可观察到，且错误结果不被静默转换为成功 | 保留 in-band MCP error 事实 |
| `large` | 固定 4096 字符内容完整到达，Transport 未截断 | 生产边界仍必须由 BloomAI 自己执行大小限制和脱敏 |

Spike 只记录结构和安全的固定长度，不把任何外部 Server 的原始敏感 output 写入日志、SQLite、HTTP response 或前端 state。

---

## 5. AbortSignal、timeout 和生命周期

- `executeTool(remoteName, input, signal)` 将 `signal` 传入 Mastra Tool 的执行 context：`{ abortSignal: signal }`；Fixture 的延迟调用在 AbortSignal 触发后拒绝，观察到的耗时约为几十毫秒，且远小于 1.5 秒上限；
- 使用 `MCPClient` 全局 `timeout: 300` 的连接，延迟 Tool 在约 300 毫秒量级拒绝，而不是等待完整延迟；
- timeout 后不会假设 client 仍然可安全复用。显式 `reconnectServer(serverName)` 后，echo 调用可以恢复；
- `disconnect()` 后再次调用 `reconnectServer(serverName)` 可以建立新连接并恢复 echo 调用；
- `disconnect()` 在清理阶段可重复调用，Fixture 子进程和 HTTP Server 会在 Spike finally 路径关闭。

Adapter 契约因此要求：

```ts
interface McpProviderConnection {
  listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]>
  executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown>
  disconnect(): Promise<void>
}
```

连接失效、timeout、取消和退出清理由 Provider/Connection Manager 负责；Capability Broker、Approval 和 Audit 仍然必须位于所有生产执行路径之上。

---

## 6. stdio 结论

stdio Fixture 通过 `process.execPath` 直接启动固定的 `tests/fixtures/mcp/stdio-server.mjs`，使用 MCP SDK `StdioServerTransport` 完成 initialize、tools/list 和 tools/call。它覆盖成功、结构化结果、in-band error、延迟和大结果 Tool。

结论：

1. 当前锁定版本可以完成一期所需的 stdio Tool discovery 和 execution；
2. Spike 不依赖远程下载、任意 `npx` 或用户真实 Token；
3. Task 1 仍必须在生产 Adapter 外层落实 `shell: false`、参数数组、最小化环境和 secret policy；本 Spike 不把 Mastra 内部子进程实现当作 BloomAI 安全策略的替代品。

---

## 7. Streamable HTTP 和 SSE fallback 结论

HTTP Fixture 使用 stateful `StreamableHTTPServerTransport`，通过 JSON response 完成最小 MCP 握手、tools/list 和 tools/call。Fixture trace 只记录请求方法、路径、Accept、Content-Type 和是否存在 session id，不记录 Authorization、Token 或请求 payload。

结论：

1. 当 Server Definition 使用 `url: new URL(...)` 时，Mastra 可以使用 Streamable HTTP 完成一期 MVP；
2. Fixture 的 POST 建立有 session id 的 stateful session，后续 MCP 请求携带该 session id；
3. `@mastra/mcp@1.15.1` 的运行时在 Streamable HTTP 失败时具备 legacy HTTP+SSE fallback 路径；
4. BloomAI MVP 采用 **fail closed**：Spike 记录 Mastra 的 deprecated HTTP+SSE fallback 日志，或发现没有 session id 的 legacy SSE 初始 GET 时，测试直接失败；
5. 不能把所有 GET 都判定为 fallback，因为 Streamable HTTP 可能产生带 session id 的合法 GET。本次检测因此同时使用 Mastra fallback 日志、GET 是否缺少 session id，以及 trace 中已有 POST/session 的证据；
6. 本次 HTTP Fixture 完成时没有检测到 fallback。独立 legacy SSE 不进入一期公共 Transport，延后到 `mcp-roadmap.md` 的 R5，并要求独立的真实 Fixture、认证、SSRF、重连和幂等性验证。

---

## 8. 最终 Adapter 契约

Task 0 冻结的是 BloomAI 内部边界，而不是要求后续代码复制 Spike helper：

```ts
interface McpProviderConnection {
  listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]>
  executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown>
  disconnect(): Promise<void>
}

interface McpProviderAdapter {
  createConnection(
    config: McpServerConnectionConfig,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection>
}
```

实现约束：

- Task 4 的正式实现可以缓存 Mastra Tool，但必须通过独立 `remoteName` 映射执行；
- 只有 `src/server/mcp/mastra-adapter.ts` 可以直接导入 `@mastra/mcp`；
- 正式 Adapter 不依赖未经验证的旧 discovery/execute/close 方法名；
- `listTools(signal?)` 的取消参数是 BloomAI 边界。当前 Mastra public `listTools()` 本身没有 signal 参数，因此本 Spike 只验证了 discovery 前置 abort 检查，未宣称 discovery 在网络请求中途可被取消；
- `executeTool` 的 abort signal 必须传递到 Mastra Tool 执行上下文，并在无法可靠取消时使连接失效；
- `executeTool` 的返回值先交给 Task 2 的 `NormalizedMcpResult` 规范化，不把 Mastra 的原始结果形态直接暴露给 Agent 或 HTTP API。

---

## 9. 已知限制和后续影响

1. Task 0 没有创建生产 `mastra-adapter.ts`、Connection Manager、Catalog、Broker、API 或 UI；这些工作严格留给后续 Task。
2. HTTP fallback 的检测是 fail-closed 观测策略；本次 Fixture 成功路径没有故意制造失败后 fallback 的服务端兼容场景，因此 R5 仍需真实 legacy SSE Fixture。
3. `resources`、`prompts`、OAuth、Elicitation、MCP Registry 和独立 legacy SSE 虽然在 Mastra 类型/运行时中存在部分能力，但不属于一期公共契约。
4. Mastra Tool 的结果、description、schema、content、structuredContent 和错误信息都视为不可信外部输入；本 Spike 不替代 Task 1/Task 2 的 SSRF、secret、schema、脱敏、截断和结果规范化策略。
5. `onToolError: 'return'` 下的 in-band `isError` 保留是运行时证据，不等于 BloomAI 的最终错误码；Task 2 必须定义稳定错误协议。
6. timeout 后的恢复路径必须显式 reconnect；生产执行不得因为 timeout 自动重试非幂等 Tool。

---

## 10. Task 0 验收对应关系

- [x] 当前精确版本完成 stdio 和 Streamable HTTP MVP discovery/execution 验证；
- [x] `mastra-adapter.contract.test.ts` 覆盖真实 Fixture 和运行时契约；
- [x] Fixture 提供成功、结构化、错误、延迟和大结果 Tool；
- [x] AbortSignal、timeout、disconnect、reconnect 有运行时断言；
- [x] SSE fallback 有可执行的 fail-closed 检测和明确结论；
- [x] 结果文档已被设计方案和实施计划引用；
- [x] 没有在 Task 0 阶段创建生产 Adapter 或绕过证据实现后续 Task。

Task 1 及后续 Task 必须在本结果文档基础上继续，并重新验证任何 Mastra 版本升级。
