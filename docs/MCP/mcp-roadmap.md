# BloomAI MCP 后续能力路线图

- **状态**：规划文档，未进入当前一期实现
- **日期**：2026-08-09
- **前置文档**：
  - 设计方案：`docs/MCP/2026-08-02-bloomai-mcp-client-design.md`
  - 一期实施计划：`docs/MCP/2026-08-02-bloomai-mcp-client-implementation-plan.md`
- **路线图基线**：只有一期 MCP Client MVP 的 Task 0～Task 10 全部通过 Release Gate 后，才允许启动本路线图中的后续能力。

---

## 1. 路线图目标

一期 MVP 只解决：

```text
BloomAI
  -> 连接外部 MCP Server
  -> 发现、确认和启用远程 Tools
  -> 通过 BloomAI Broker 审批、执行和审计
  -> 将允许的 Tools 提供给 Mastra Agent
```

本路线图用于拆分一期之后的能力，避免把 Resources、Prompts、Elicitation、OAuth、Registry、SSE 和高级隔离能力混入一期主线，导致 Adapter、Broker、API 和安全边界不稳定。

后续能力必须遵守以下原则：

1. 所有远程能力仍然经过 BloomAI Provider Adapter 和 Capability Broker；
2. 不直接把 Mastra 原始能力对象挂到 Agent；
3. Feature Flag 未开启时 fail closed；
4. 外部描述、Prompt、Resource、Content 和结构化结果均视为不可信输入；
5. 不把解析后的秘密、OAuth Token、Cookie、Authorization Header 或原始敏感内容写入日志、前端状态或普通业务表；
6. 新增能力必须有真实协议 Fixture、Fake Adapter、攻击面测试和回滚策略；
7. 版本和 Mastra API 以 `mcp-mastra-spike-result.md` 以及后续升级 Spike 为唯一实现依据。

---

## 2. 路线图能力矩阵

| 能力 | 一期 MVP | Roadmap 状态 | 推荐顺序 |
|---|---|---|---:|
| Tools | 支持 | 基线能力 | MVP |
| stdio | 支持 | 基线能力 | MVP |
| Streamable HTTP | 支持 | 基线能力 | MVP |
| legacy SSE | 不公开支持 | 兼容性扩展 | R5 |
| Resources | 不支持 | 只读资源能力 | R1 |
| Prompts | 不支持 | 受控 Prompt 模板能力 | R2 |
| Elicitation | 不支持 | 服务器请求用户结构化输入 | R3 |
| OAuth | 不支持 | 远程 HTTP 授权和 Token 生命周期 | R4 |
| MCP Registry | 不支持 | Server 发现、审核和导入 | R6 |
| Secret Vault | 仅环境变量引用 | 安全增强 | R7 |
| OS/容器沙箱 | 不支持 | 高风险 stdio 隔离 | R7 |
| 多租户凭据托管 | 不支持 | 云端部署能力 | R7 |

---

## 3. Roadmap 前置 Gate

R0 是一期完成后的安全和可观测性复核，不新增协议能力，但必须在启动 R1 之前完成：

- [ ] 重新执行一期真实 stdio/HTTP、SSRF、Secret、Approval、Timeout 和 Feature Flag 回归；
- [ ] 核对指标、日志、Run 审计、Safe DTO 和输出截断；
- [ ] 核对 Design、Implementation Plan、Spike Result 与实际实现一致；
- [ ] 确认后续能力不会修改一期 Tools 的默认安全策略。

每个 Roadmap 阶段开始前必须满足：

- [ ] 一期 `MCP_CLIENT_ENABLED`、Server、Tool、Catalog、Broker 和 Run 状态机已稳定；
- [ ] `@mastra/mcp` 精确版本和 Adapter 契约已经有 Spike 结果；
- [ ] `/api/v1/mcp` 和当前 UI 已经可用；
- [ ] `NormalizedMcpResult`、Safe DTO、脱敏和截断策略已经稳定；
- [ ] Approval Store 能支持新能力的审批需求；
- [ ] 一期真实 stdio/HTTP Fixture 和安全测试通过；
- [ ] 新能力拥有独立 Feature Flag，默认关闭；
- [ ] 新能力不会改变一期 Tools 的默认安全行为；
- [ ] Migration 只能使用当前仓库下一个未占用编号，并同步 Schema Contract 和 Repository Test。

后续能力不能通过修改已有 Tool 执行路径来绕过 Broker；需要扩展稳定的 Provider、Capability 和审计接口。

---

## 4. R1：Resources 只读资源能力

### 4.1 目标

将外部 MCP Server 的 Resources 以受控、只读、可审计的方式提供给 BloomAI。Resources 不应自动进入 Agent 上下文，必须由明确的用户请求、Tool 逻辑或 Policy 决定是否读取。

建议 Feature Flag：

```text
MCP_RESOURCES_ENABLED
```

默认值：关闭。

### 4.2 范围

- `resources/list`；
- `resources/read`；
- 如果 Mastra 版本支持，评估 resource templates；
- Resource URI 校验；
- Resource MIME 类型和大小限制；
- Resource 内容脱敏、截断和审计；
- Server、Role、Session 级 Resource Scope；
- Resource 读取缓存和失效策略。

### 4.3 设计要求

- Resource URI 必须保留 Server 命名空间，不能让外部 URI 覆盖本地资源标识；
- 禁止把 Resource 内容自动拼接到系统 Prompt；
- Resource 内容必须经过 `NormalizedMcpResource`；
- 二进制内容默认拒绝或只返回安全元数据；
- 限制单次内容大小、总读取量和读取频率；
- Resource 读取需要独立审计，不复用 Tool Run 的语义字段；
- Resource 读取也必须检查 Server/Role/Feature Flag；
- URL 类型 Resource 必须再次执行 SSRF 检查，不能因为 MCP Server 返回就信任。

### 4.4 可能的新增模块

```text
src/server/mcp/resource-catalog.ts
src/server/mcp/resource-broker.ts
src/server/mcp/resource-normalizer.ts
src/server/mcp/resource.repo.ts
```

### 4.5 验收标准

- [ ] 能够列出经过确认的 Resources；
- [ ] 只能读取允许的 Resource；
- [ ] 大内容、二进制、非法 URI、SSRF 和超时都有明确错误；
- [ ] Resource 内容不会绕过 Prompt Injection 防护进入 Agent；
- [ ] 审计记录不包含秘密和未经脱敏内容；
- [ ] `MCP_RESOURCES_ENABLED=false` 时一期 Tools 行为不变。

**依赖**：一期 Task 0～Task 10、R0 安全复核。

---

## 5. R2：Prompts 受控 Prompt 模板能力

### 5.1 目标

发现和获取外部 MCP Server 提供的 Prompts，但不允许外部 Prompt 自动覆盖 BloomAI 系统指令、Agent Role Policy 或安全约束。

建议 Feature Flag：

```text
MCP_PROMPTS_ENABLED
```

默认值：关闭。

### 5.2 范围

- `prompts/list`；
- `prompts/get`；
- Prompt 参数 Schema 校验；
- Prompt Preview；
- 用户显式选择后插入当前会话；
- Prompt 来源、版本和审计；
- Prompt 内容长度和消息数量限制。

### 5.3 设计要求

- 外部 Prompt 只能作为用户可见的候选模板，不能修改系统指令；
- 必须显示来源 Server、Prompt 名称和参数；
- Prompt 参数由服务端按 Schema 校验；
- Prompt 内容进入 Agent 前必须标记为外部不可信内容；
- 禁止把 Prompt 中的“忽略之前指令”等内容提升为系统级策略；
- Prompt 选择和渲染需要审计；
- Prompt 的远程变化需要重新 Preview/Confirm；
- Prompt 不应默认进入所有 Role 的 Tool Surface。

### 5.4 可能的新增模块

```text
src/server/mcp/prompt-catalog.ts
src/server/mcp/prompt-renderer.ts
src/server/mcp/prompt-policy.ts
src/server/mcp/prompt.repo.ts
```

### 5.5 验收标准

- [ ] Prompt 可发现、Preview、参数校验和显式使用；
- [ ] Prompt 不能覆盖系统指令、Role Scope 或 Tool Policy；
- [ ] Prompt 注入样例能够被识别和隔离；
- [ ] Prompt 内容和参数不泄露秘密；
- [ ] Prompt 变化会触发版本或重新确认；
- [ ] Feature Flag 关闭时一期 Chat 行为不变。

**依赖**：R1 的外部内容规范化和审计能力建议先完成；一期 Task 0～Task 10。

---

## 6. R3：Elicitation 服务器请求用户输入

### 6.1 目标

处理 MCP Server 在执行期间向用户请求结构化信息的场景。Elicitation 不能由后台连接直接阻塞等待无限时间，也不能让远端 Server 获得未审批的用户输入。

建议 Feature Flag：

```text
MCP_ELICITATION_ENABLED
```

默认值：关闭。

### 6.2 范围

- 接收服务器 Elicitation 请求；
- 将请求转换为安全 UI DTO；
- 显示结构化 Schema、用途、来源 Server 和过期时间；
- 用户提交、拒绝、取消和超时；
- Session、Run、Role 绑定；
- 用户输入的二次校验和脱敏；
- 应用退出、断线和重复提交处理。

### 6.3 设计要求

- Elicitation 请求必须绑定具体 Run 和 Server；
- 服务器不能指定 UI 行为或注入 HTML/脚本；
- Schema 只支持显式允许的 JSON Schema 子集；
- 用户必须明确确认后，输入才能回传 MCP Server；
- 敏感字段默认不写入普通审计记录；
- 拒绝和超时必须让远端调用进入确定状态；
- 同一个 Elicitation Request 只能响应一次；
- 不允许任意后台任务长期持有用户等待状态。

### 6.4 可能的新增模块

```text
src/server/mcp/elicitation-broker.ts
src/server/mcp/elicitation-store.ts
src/server/http/routes/mcp-elicitation.ts
src/renderer/pages/McpServers/ElicitationDialog.*
```

### 6.5 验收标准

- [ ] Elicitation 能显示安全表单并返回结构化结果；
- [ ] 用户拒绝、取消、超时和应用退出均有确定行为；
- [ ] 重放、跨 Session、跨 Role 和跨 Run 响应均被拒绝；
- [ ] 用户输入不会泄露到日志和普通 UI Store；
- [ ] 服务器返回的 Schema 和文案不会成为系统指令；
- [ ] Feature Flag 关闭时服务器 Elicitation 被安全拒绝并审计。

**依赖**：R1/R2 的外部内容和 Schema 规范化；一期 Broker、Run 和 UI。

---

## 7. R4：OAuth 远程授权

### 7.1 目标

为需要 OAuth 的远程 HTTP MCP Server 提供浏览器授权、Token 安全存储、刷新和撤销能力，同时保持一期环境变量引用方案兼容。

建议 Feature Flag：

```text
MCP_OAUTH_ENABLED
```

默认值：关闭。

### 7.2 范围

- OAuth Provider 元数据发现或显式配置；
- Authorization Code + PKCE；
- 本地安全回调；
- Access Token、Refresh Token 生命周期；
- Token 刷新和并发刷新锁；
- 用户撤销和重新授权；
- 多 Server、多用户和多 Session 隔离；
- OAuth 错误映射和重新授权 UI。

### 7.3 设计要求

- 不把 OAuth Token 存入普通 `mcp_servers.config_json`；
- 在 Secret Vault 可用前，必须明确桌面端安全存储方案；
- 不在日志、URL、前端普通状态或错误中泄露 Token；
- redirect URI 必须固定、校验来源并防止 CSRF；
- 使用 PKCE，state 必须绑定用户和授权请求；
- Token 刷新必须防并发竞态；
- Server 配置、OAuth Client、用户和 Role 必须隔离；
- OAuth 失败时不能退回到未经授权的匿名调用；
- HTTP redirect 和 OAuth endpoint 仍需执行 SSRF/域名策略。

### 7.4 可能的新增模块

```text
src/server/mcp/oauth/oauth.service.ts
src/server/mcp/oauth/oauth-callback.ts
src/server/mcp/oauth/token-store.ts
src/server/http/routes/mcp-oauth.ts
src/renderer/pages/McpServers/OAuth*.tsx
```

### 7.5 验收标准

- [ ] PKCE 授权、回调、Token 保存、刷新和撤销可用；
- [ ] state、PKCE verifier、用户和 Server 绑定正确；
- [ ] Token 不出现在日志、URL、普通 DTO 和快照；
- [ ] 并发刷新不会丢失或覆盖有效 Token；
- [ ] Token 失效时返回明确的重新授权状态；
- [ ] Feature Flag 关闭时 OAuth endpoint fail closed；
- [ ] 一期 `${env:NAME}` 引用方式继续可用，不被 OAuth 改写。

**依赖**：一期 Task 0～Task 10；建议先完成 R7 Secret Vault 的最小安全存储能力。

---

## 8. R5：legacy SSE 和 Transport 兼容性扩展

### 8.1 目标

只有 Task 0 或真实生态验证证明需要时，才增加 legacy SSE 支持。SSE 不能因为 Mastra HTTP fallback 而被隐式纳入产品。

建议 Feature Flag：

```text
MCP_SSE_ENABLED
```

默认值：关闭。

### 8.2 进入条件

- [ ] Task 0 已记录当前 `@mastra/mcp` 的 SSE fallback 行为；
- [ ] 已有真实 SSE Fixture；
- [ ] 已明确 SSE 与 Streamable HTTP 的认证、重连和关闭差异；
- [ ] 已完成 SSRF、redirect、DNS、timeout 和资源清理测试；
- [ ] 产品明确需要兼容无法升级的 legacy MCP Server。

### 8.3 设计要求

- SSE endpoint 和 message endpoint 必须执行独立 URL/SSRF 校验；
- SSE 重连不得重复执行非幂等 Tool；
- 事件 ID、重放和断线状态必须绑定 Run；
- 应用退出和 timeout 必须关闭 EventSource/HTTP stream；
- 认证 Header 不写日志；
- SSE 协议错误不得静默降级为匿名 HTTP 调用；
- UI 必须显示当前 Server 使用的实际 Transport。

### 8.4 验收标准

- [ ] SSE 连接、tools/list、tools/call、断线、重连和关闭通过；
- [ ] 重连不会重复执行不安全操作；
- [ ] SSE 和 Streamable HTTP 使用统一 Catalog、Broker、Approval 和 Run 语义；
- [ ] 兼容失败时返回明确 `MCP_PROTOCOL_ERROR` 或 Transport 错误；
- [ ] Feature Flag 关闭时 SSE 被拒绝，不影响一期 HTTP。

**依赖**：Task 0 Spike、Task 4 Adapter、Task 6 Broker。

---

## 9. R6：MCP Registry 和 Server 发现

### 9.1 目标

允许用户从受信任 Registry 发现 Server 元数据，但不自动安装、自动执行或绕过人工确认。

建议 Feature Flag：

```text
MCP_REGISTRY_ENABLED
```

默认值：关闭。

### 9.2 范围

- Registry 来源配置和 allowlist；
- Server 元数据搜索和详情；
- 版本、Transport、权限和供应链信息展示；
- 导入为待确认的本地 Server Draft；
- 用户确认后才保存为正式配置；
- Registry 元数据缓存和失效；
- Registry 条目与实际 Server 配置分离。

### 9.3 设计要求

- Registry 不能自动下载或执行 stdio 命令；
- `command`、`args`、`cwd`、环境变量和 URL 必须经过本地安全策略；
- Registry 返回的描述、图标、文档和 Tool Schema 都是不可信内容；
- Registry 来源必须 allowlist；
- Registry 条目更新不能自动改变已启用 Server；
- 版本升级必须重新 Preview/Confirm；
- 安装、导入和升级动作必须审计；
- Registry 不得读取或返回现有 Server 的 Secret。

### 9.4 可能的新增模块

```text
src/server/mcp/registry/registry-client.ts
src/server/mcp/registry/registry-policy.ts
src/server/mcp/registry/registry.repo.ts
src/server/http/routes/mcp-registry.ts
src/renderer/pages/McpServers/Registry*.tsx
```

### 9.5 验收标准

- [ ] 只允许读取 allowlist Registry；
- [ ] Registry Server 可以导入为 Draft；
- [ ] 未经用户确认不会建立连接、安装包或执行命令；
- [ ] 版本变更触发 Preview/Confirm；
- [ ] Registry 内容经过 Prompt Injection 和内容大小限制；
- [ ] Registry Feature Flag 关闭时一期配置和执行不受影响。

**依赖**：一期 Catalog、Security、UI；建议在 OAuth 和 SSE 策略明确后实施。

---

## 10. R7：Secret Vault、沙箱和部署级安全增强

### 10.1 Secret Vault

目标是将一期的 `${env:NAME}` 引用扩展为系统安全存储，同时保持业务表不保存明文。

建议 Feature Flag：

```text
MCP_SECRET_VAULT_ENABLED
```

验收重点：

- [ ] Secret 以操作系统 Keychain、Electron safeStorage 或受认可的 Vault 保存；
- [ ] 数据库只保存 Secret Reference；
- [ ] UI 只能创建、轮换、撤销和显示元数据；
- [ ] Token 和 Header 不进入日志、错误和 IPC 普通消息；
- [ ] 备份、迁移和删除策略明确；
- [ ] 运行时只在最小生命周期内解密。

### 10.2 stdio 沙箱

目标是降低运行外部本地命令的风险。

可能能力：

- 固定可执行文件 allowlist；
- 最小权限账户；
- cwd 和文件系统白名单；
- 网络权限控制；
- CPU、内存、进程数和运行时间限制；
- 容器或操作系统级隔离；
- 子进程行为审计。

必须注意：沙箱不能替代 MCP Broker、Approval 和 Tool Scope。

### 10.3 多租户和云端凭据隔离

如果 BloomAI 进入多用户云端部署，需要单独设计：

- Tenant、User、Server、Secret、OAuth Client 的隔离；
- 每租户 Catalog 和 Approval；
- 凭据加密和密钥轮换；
- 管理员审计；
- 跨租户 SSRF、资源和速率限制；
- 删除、导出、备份和合规策略。

**依赖**：OAuth、Registry、部署形态和安全审计决策。

---

## 11. 推荐后续实施顺序

```text
一期 MVP Task 0～Task 10
  -> R0 一期安全和可观测性复核
  -> R1 Resources
  -> R2 Prompts
  -> R3 Elicitation
  -> R7 Secret Vault 最小能力
  -> R4 OAuth
  -> R5 legacy SSE（仅在真实需求确认后）
  -> R6 MCP Registry
  -> R7 stdio 沙箱 / 多租户部署安全
```

说明：

- R1 和 R2 可以在一期稳定后分别实施，但都必须复用外部内容规范化和 Broker 边界；
- R3 依赖 UI、Session、Run 和长连接生命周期，不能在一期审批状态机不稳定时实施；
- OAuth 建议在 Secret Vault 最小能力之后实施，避免把 Token 放入临时存储；
- SSE 不是必然需求，只有真实 Server 兼容性证明需要时实施；
- Registry 必须晚于 Transport、安全和人工 Confirm 流程；
- 沙箱和多租户属于部署级安全工作，不应通过简单的应用层开关伪装完成。

---

## 12. 每个 Roadmap 阶段的统一交付物

每个阶段至少要有：

1. 设计变更说明或 ADR；
2. 领域类型和稳定错误码；
3. Feature Flag 和 fail-closed 行为；
4. Fake Adapter 测试；
5. 真实协议 Fixture 或受控集成测试；
6. 安全和 Prompt Injection 测试；
7. Migration、Schema Contract 和 Repository 测试（如有持久化）；
8. API、UI 和 Agent 契约测试（如影响对应层）；
9. 观测、审计和错误恢复说明；
10. 文档同步和 Release Gate 结果。

任何阶段不得以“Mastra 已支持该能力”作为跳过 BloomAI 安全、审批、审计和权限边界的理由。

---

## 13. Roadmap 发布阻断条件

以下情况必须停止后续能力发布：

- 新能力绕过 MCP Capability Broker；
- 新能力允许客户端伪造审批、信任、Role 或启用状态；
- 外部内容自动提升为系统指令；
- Secret、OAuth Token、Cookie 或 Authorization Header 泄露；
- 新 Transport 未经过 SSRF、重连、超时和关闭测试；
- Resource/Prompt/Elicitation 内容无限制进入 Agent 上下文；
- Registry 可未经确认执行命令或下载可执行文件；
- 新 Migration 与当前序号冲突；
- Feature Flag 关闭后影响一期 Tools 或既有 BloomAI 功能；
- Design、Implementation Plan、Spike Result 和 Roadmap 之间出现契约不一致。
