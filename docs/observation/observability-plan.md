# BloomAI 可观测性方案

> 版本：v1.0 · 2026-07-05  
> 状态：设计方案（待实现）

---

## 目录

1. [现状分析](#1-现状分析)
2. [目标与原则](#2-目标与原则)
3. [Mastra 原生可观测能力](#3-mastra-原生可观测能力)
4. [整体架构](#4-整体架构)
5. [三大支柱详细设计](#5-三大支柱详细设计)
   - 5.1 [Logging — 结构化日志](#51-logging--结构化日志)
   - 5.2 [Tracing — 分布式追踪](#52-tracing--分布式追踪)
   - 5.3 [Metrics — 指标度量](#53-metrics--指标度量)
6. [OtelExporter 接入外部系统](#6-otelexporter-接入外部系统)
7. [分阶段实施计划](#7-分阶段实施计划)
8. [关键配置与环境变量](#8-关键配置与环境变量)
9. [本地开发环境搭建](#9-本地开发环境搭建)
10. [各方案对比与推荐](#10-各方案对比与推荐)

---

## 1. 现状分析

### 1.1 当前可观测能力盘点

| 维度 | 当前状态 | 问题 |
|------|---------|------|
| **日志** | 自定义 JSONL 文件日志（`src/server/logger/logger.ts`） | 只记录错误；无 scope/level 层级路由；无 traceId 关联；无 stdout 输出，无法被容器日志系统采集 |
| **追踪** | 无 | Agent 执行、Tool 调用、LLM 请求等所有调用链完全不透明 |
| **指标** | 无 | 无法度量 LLM 延迟、Token 用量、生图成功率等关键业务指标 |
| **请求 ID** | 无 | HTTP 请求无 correlation ID，无法跨日志关联单次请求 |

### 1.2 Mastra 实例现状

```typescript
// src/server/mastra/index.ts — 当前构造，无任何可观测配置
export const mastra = new Mastra({
  storage: new InMemoryStore(),
  agents: { chat, 'plan-planner', 'research-writer', ... },   // 7 个 Agent
  workflows: { 'deep-research': deepResearchWorkflow },
  // ← telemetry / logger 字段缺失
})
```

**关键缺口：** Mastra `@mastra/core` v1.46.0 在构造函数中直接支持 `telemetry`（OTel）和 `logger` 两个选项，目前均未使用。

### 1.3 需要特殊处理的组件

以下组件**绕过了** Mastra 内部路由，需要单独埋点：

- **`src/server/mastra/model-resolver.ts`** — 自定义模型解析器，直接调用 AI SDK provider，LLM 延迟不经过 Mastra 的 span
- **`src/server/services/image-studio.service.ts`** — 图片生成完整流程（prompt 优化 → 调用图片模型），Mastra 不感知
- **`src/server/http/app.ts`** — Hono HTTP 层，无请求追踪中间件

---

## 2. 目标与原则

### 2.1 目标

1. **Logging**：所有服务端日志结构化、分级、含 `traceId/sessionId`，同时写本地文件和 stdout
2. **Tracing**：所有 Agent 执行、Tool 调用、Workflow 步骤、LLM 请求自动生成 OTel span；HTTP 请求链路端到端可追踪
3. **Metrics**：LLM 延迟/Token/Provider 维度指标；图片生成成功率；会话活跃数
4. **外部接入**：通过 `OtelExporter` 可无缝对接 Jaeger、Grafana Tempo、Honeycomb、Datadog 等

### 2.2 设计原则

- **最小侵入**：优先利用 Mastra 内置能力，避免重复造轮子
- **配置驱动**：所有可观测功能通过环境变量开关，开发环境默认 console，生产环境 OTLP
- **不泄漏密钥**：保留现有 `sanitizeForLog` 逻辑，OTel attribute 同样脱敏
- **渐进实施**：分三个阶段，Phase 1 可立即上线，不阻塞其他开发

---

## 3. Mastra 原生可观测能力

### 3.1 Logger — `createLogger`

`@mastra/core` 导出 `createLogger`，底层基于 **Pino**，支持四种输出类型：

| type | 说明 | 适用场景 |
|------|------|---------|
| `CONSOLE` | 带颜色的 pretty-print 输出到 stdout | 本地开发 |
| `FILE` | 追加写到指定文件路径 | 生产备份 |
| `UPSTASH` | 推送到 Upstash Redis（云托管） | SaaS 场景 |
| `CUSTOM` | 传入任意 Pino transport | 自定义接入 |

```typescript
import { createLogger, LogLevel } from '@mastra/core/logger'

// 开发环境 — console pretty
const logger = createLogger({ type: 'CONSOLE', level: LogLevel.DEBUG })

// 生产环境 — 同时写文件 + stdout
const logger = createLogger({
  type: 'FILE',
  level: LogLevel.INFO,
  dirPath: '~/.bloomai/logs',
})
```

Mastra 内部会自动把 Agent 执行日志、Workflow 步骤日志通过这个 logger 输出，**无需手动埋点**。

### 3.2 Tracing — `telemetry` (OTel)

Mastra 构造函数接受 `telemetry: OtelConfig`，内部使用 **OpenTelemetry Node.js SDK** 自动完成以下 span 的创建：

| 自动追踪的操作 | Span 名称模式 |
|--------------|--------------|
| Agent 执行 | `agent.{agentName}.execute` |
| Tool 调用 | `tool.{toolName}.execute` |
| Workflow 步骤 | `workflow.{workflowName}.step.{stepId}` |
| AI SDK LLM 调用（通过 Mastra 路由） | `ai.generateText` / `ai.streamText` |
| 内存读写 | `memory.getMessages` / `memory.addMessage` |

```typescript
// OtelConfig 结构
interface OtelConfig {
  serviceName?: string           // OTLP resource.service.name
  enabled?: boolean              // 默认 true
  sampling?: {
    type: 'ratio' | 'always_on' | 'always_off'
    probability?: number         // ratio 模式下 0-1
  }
  export?: {
    type: 'otlp' | 'console'
    endpoint?: string            // OTLP endpoint, e.g. http://localhost:4318
    headers?: Record<string, string>
  }
}
```

### 3.3 OtelExporter — 接入外部系统

`@mastra/core` 提供 `OtelExporter` 类（位于 `@mastra/core/telemetry/otel-exporter`），它是对 OTel `SpanExporter` 接口的封装，可直接传给 `telemetry.exporter`：

```typescript
import { OtelExporter } from '@mastra/core/telemetry/otel-exporter'

const exporter = new OtelExporter({
  type: 'otlp',
  url: 'https://api.honeycomb.io/v1/traces',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY! },
})

const mastra = new Mastra({
  telemetry: {
    serviceName: 'bloomai',
    enabled: true,
    exporter,
  },
})
```

也可以直接传入任何标准 OTel exporter（`@opentelemetry/exporter-jaeger`、`@opentelemetry/exporter-prometheus` 等）。

---

## 4. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  BloomAI Server (Hono + Mastra)                                      │
│                                                                       │
│  HTTP 层                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  RequestId Middleware  ──────────── traceId 注入 Context     │    │
│  │  OTel HTTP Middleware  ──────────── HTTP span 自动生成       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│             │                                                         │
│  Mastra 层（自动 span）                                               │
│  ┌──────────┬──────────┬──────────────┬────────────────────────┐    │
│  │  Agent   │   Tool   │  Workflow    │  Memory (LibSQL)        │    │
│  │  spans   │  spans   │  step spans  │  query spans           │    │
│  └──────────┴──────────┴──────────────┴────────────────────────┘    │
│             │                                                         │
│  手动埋点层（需实现）                                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  model-resolver.ts  ── LLM Provider span + token metrics     │   │
│  │  image-studio.service.ts ── 图片生成 span + 成功率指标        │   │
│  │  optimizePrompt()   ── prompt 优化 span                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌────────────────────────────────┐                                  │
│  │  Pino Logger (Mastra createLogger)                               │  │
│  │  → stdout  → ~/.bloomai/logs/  │                                  │
│  └────────────────────────────────┘                                  │
│                                                                       │
│  ┌────────────────────────────────┐                                  │
│  │  OTel SDK                      │                                  │
│  │  TracerProvider + MeterProvider│                                  │
│  └──────────┬─────────────────────┘                                  │
└─────────────┼───────────────────────────────────────────────────────┘
              │  OTLP/gRPC 或 OTLP/HTTP
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  可观测性后端（按环境选择）                                            │
│                                                                       │
│  开发环境:  Jaeger (localhost:16686)  ←──  docker-compose           │
│             Prometheus (localhost:9090)                               │
│             Grafana (localhost:3000)                                  │
│                                                                       │
│  生产环境:  Grafana Cloud LGTM Stack                                  │
│          或 Honeycomb / Datadog / Signoz                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. 三大支柱详细设计

### 5.1 Logging — 结构化日志

#### 目标状态

- 统一使用 Mastra `createLogger`（基于 Pino），替代现有手写 `appendLog`
- 保留原有文件输出 + 增加 stdout 输出（对接容器日志采集）
- 所有日志自动携带 `traceId`（从 OTel Context 读取）
- 保留现有 `sanitizeForLog` API 密钥脱敏逻辑

#### 实现要点

**Step 1 — 创建统一 logger 工厂** (`src/server/logger/index.ts`)

```typescript
import { createLogger, LogLevel } from '@mastra/core/logger'
import { getLogDir } from './logger'  // 复用现有路径逻辑

const isDev = process.env.NODE_ENV !== 'production'

export const serverLogger = createLogger(
  isDev
    ? { type: 'CONSOLE', level: LogLevel.DEBUG }
    : { type: 'FILE', level: LogLevel.INFO, dirPath: getLogDir() }
)
```

**Step 2 — 兼容层**：现有 `logError` / `appendLog` 调用者无需修改，通过薄包装对接新 logger：

```typescript
// 现有 logError 保持签名不变，内部委托给 serverLogger
export function logError(scope: string, error: unknown, details?: Record<string, unknown>) {
  serverLogger.error({ scope, ...sanitizeForLog(details) }, sanitizeErrorMessage(error))
}
```

**Step 3 — traceId 注入**：在 Hono 请求中间件里把 OTel traceId 写入 AsyncLocalStorage，logger 自动读取：

```typescript
// src/server/http/middleware/request-context.ts
import { trace } from '@opentelemetry/api'

app.use('*', async (c, next) => {
  const spanContext = trace.getActiveSpan()?.spanContext()
  const traceId = spanContext?.traceId ?? crypto.randomUUID().replace(/-/g, '')
  c.set('traceId', traceId)
  await next()
})
```

#### 日志字段规范

```jsonc
{
  "timestamp": "2026-07-05T10:23:45.123Z",
  "level": "info",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",  // ← OTel 自动注入
  "sessionId": "sess_abc123",
  "scope": "chat.route",
  "msg": "Agent stream started",
  "model": "claude-sonnet-4-6",
  "agentId": "chat"
}
```

---

### 5.2 Tracing — 分布式追踪

#### Mastra 自动 span（零代码成本）

在 Mastra 构造函数添加 `telemetry` 选项后，以下调用链自动生成 span：

```
HTTP POST /api/v1/chat
  └─ agent.chat.execute                          [自动]
       ├─ ai.streamText (claude-sonnet-4-6)       [自动]
       ├─ tool.web_search.execute                 [自动]
       │    └─ ai.generateText (embedding)        [自动]
       ├─ memory.getMessages                      [自动]
       └─ memory.addMessage                       [自动]

HTTP POST /api/v1/workflows/deep-research
  └─ workflow.deep-research.execute              [自动]
       ├─ workflow.deep-research.step.plan        [自动]
       ├─ workflow.deep-research.step.search      [自动]
       └─ workflow.deep-research.step.write       [自动]
```

#### 手动埋点清单

以下调用链在 Mastra 路由之外，需手动添加 span：

| 位置 | span 名称 | 关键 attribute |
|------|----------|--------------|
| `model-resolver.ts` `resolveMastraModel()` | `llm.resolve` | `model`, `provider`, `modality` |
| `image-studio.service.ts` `generateForSession()` | `image.generate` | `model`, `provider`, `optimized`, `style`, `size` |
| `image-studio.service.ts` `optimizePrompt()` | `image.optimize_prompt` | `optimizer_model`, `used_fallback` |
| Hono HTTP handler | `http.request` | `http.method`, `http.route`, `http.status_code` |

**手动 span 示例（image-studio.service.ts）：**

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api'

const tracer = trace.getTracer('bloomai.image-studio')

export async function generateForSession(input: GenerateForSessionInput) {
  return tracer.startActiveSpan('image.generate', async (span) => {
    span.setAttributes({
      'image.model': input.model,
      'image.optimized': String(input.optimize !== false),
      'image.style': input.styleId ?? 'none',
    })
    try {
      const result = await doGenerate(input)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)
      throw err
    } finally {
      span.end()
    }
  })
}
```

#### Mastra `telemetry` 配置（src/server/mastra/index.ts）

```typescript
import { OtelExporter } from '@mastra/core/telemetry/otel-exporter'

function buildTelemetry() {
  const enabled = process.env.OTEL_ENABLED !== 'false'
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // 外部 OTLP 接收器（Jaeger / Grafana Tempo / Honeycomb 等）
    return {
      serviceName: 'bloomai',
      enabled,
      sampling: { type: 'ratio' as const, probability: Number(process.env.OTEL_SAMPLING_RATIO ?? 1) },
      exporter: new OtelExporter({ type: 'otlp', url: `${endpoint}/v1/traces` }),
    }
  }

  // 开发环境默认 console exporter
  return {
    serviceName: 'bloomai',
    enabled,
    export: { type: 'console' as const },
  }
}

export const mastra = new Mastra({
  storage: new InMemoryStore(),
  logger: serverLogger,           // ← Phase 1 新增
  telemetry: buildTelemetry(),    // ← Phase 2 新增
  agents: { ... },
  workflows: { ... },
})
```

---

### 5.3 Metrics — 指标度量

#### 核心指标清单

**LLM 指标**

| 指标名 | 类型 | 维度 | 说明 |
|--------|------|------|------|
| `bloomai.llm.request.duration` | Histogram | `provider`, `model`, `status` | LLM 请求延迟（ms） |
| `bloomai.llm.tokens.prompt` | Counter | `provider`, `model` | 输入 Token 累计 |
| `bloomai.llm.tokens.completion` | Counter | `provider`, `model` | 输出 Token 累计 |
| `bloomai.llm.errors.total` | Counter | `provider`, `model`, `error_code` | LLM 错误次数 |

**图片生成指标**

| 指标名 | 类型 | 维度 | 说明 |
|--------|------|------|------|
| `bloomai.image.generate.duration` | Histogram | `provider`, `model`, `status` | 生图延迟（ms） |
| `bloomai.image.optimize.fallback.total` | Counter | — | 优化回退到原始提示词次数 |

**业务指标**

| 指标名 | 类型 | 维度 | 说明 |
|--------|------|------|------|
| `bloomai.chat.session.active` | UpDownCounter | — | 活跃 chat session 数 |
| `bloomai.tool.calls.total` | Counter | `tool_name`, `status` | Tool 调用次数 |
| `bloomai.http.request.duration` | Histogram | `method`, `route`, `status_code` | HTTP 请求延迟 |

#### OTel Metrics SDK 初始化

```typescript
// src/server/telemetry/metrics.ts
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { metrics } from '@opentelemetry/api'

export function initMetrics() {
  const exporter = new OTLPMetricExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/metrics`,
  })

  const meterProvider = new MeterProvider({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'bloomai' }),
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 30_000 })],
  })

  metrics.setGlobalMeterProvider(meterProvider)
  return meterProvider
}

// 全局 meter — 各模块按需导入使用
export const meter = metrics.getMeter('bloomai', '0.3.0')
```

#### 使用示例（model-resolver.ts 埋点）

```typescript
import { meter } from '../telemetry/metrics'

const llmDuration = meter.createHistogram('bloomai.llm.request.duration', {
  unit: 'ms',
  description: 'LLM request duration',
})

// 在 resolveMastraModel() 包装处
const start = Date.now()
try {
  const result = await callLLM(...)
  llmDuration.record(Date.now() - start, { provider, model, status: 'success' })
  return result
} catch (err) {
  llmDuration.record(Date.now() - start, { provider, model, status: 'error' })
  throw err
}
```

---

## 6. OtelExporter 接入外部系统

Mastra 的 `OtelExporter` 和标准 OTel OTLP exporter 均通过以下配置切换后端，不需要改代码，只需改环境变量。

### 6.1 接入方案对比

| 方案 | 协议 | 适用场景 | 成本 |
|------|------|---------|------|
| **Jaeger** | OTLP/HTTP | 本地开发、自托管 | 免费 |
| **Grafana LGTM Stack** | OTLP/HTTP | 生产自托管一体化 | 免费（自托管） |
| **Grafana Cloud** | OTLP/HTTP | SaaS 托管，免运维 | 免费额度 + 付费 |
| **Honeycomb** | OTLP/HTTP | Traces 专注，开发体验好 | 免费 2000万事件/月 |
| **Datadog** | OTLP/gRPC | 企业级一体化 | 付费 |
| **SigNoz** | OTLP/gRPC | 开源自托管，Datadog 替代 | 免费（自托管） |

### 6.2 推荐接入路径

**开发环境 → Jaeger（最简单，一行 docker）**

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

环境变量：
```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

访问 `http://localhost:16686` 查看 trace。

**生产环境 → Grafana LGTM（Traces + Metrics + Logs 一体化）**

```yaml
# docker-compose.yml（生产自托管参考）
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports: ["4317:4317", "4318:4318"]
    volumes: ["./otel-collector.yaml:/etc/otel/config.yaml"]

  tempo:
    image: grafana/tempo:latest
    ports: ["3200:3200"]

  prometheus:
    image: prom/prometheus:latest
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    ports: ["3000:3000"]
```

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SAMPLING_RATIO=0.5   # 生产环境 50% 采样
```

**SaaS 零运维 → Honeycomb（免费额度充足，Trace 体验极佳）**

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<your-api-key>
```

代码层只需在 `OtelExporter` 配置 headers：

```typescript
new OtelExporter({
  type: 'otlp',
  url: 'https://api.honeycomb.io/v1/traces',
  headers: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
  },
})
```

---

## 7. 分阶段实施计划

### Phase 1 — 结构化日志（1-2天，零风险）

**改动范围**：仅 `src/server/logger/` 和 `src/server/mastra/index.ts`

- [ ] 安装依赖：无新包（`@mastra/core` 已包含 `createLogger`）
- [ ] 创建 `src/server/logger/index.ts` — `createLogger` 工厂，读取 `LOG_LEVEL` env var
- [ ] 在 `src/server/mastra/index.ts` 注入 `logger` 选项
- [ ] 兼容适配：`logError` / `appendLog` 委托给新 logger，现有调用者无改动
- [ ] `src/server/http/app.ts` 增加请求日志中间件（requestId + method + path + status + duration）
- [ ] 测试：启动 server，确认日志结构化输出

**产出**：所有 Agent 执行日志、HTTP 请求日志统一结构化，携带 scope/level/timestamp。

---

### Phase 2 — OTel Tracing（3-5天）

**改动范围**：`src/server/mastra/index.ts`、`src/server/index.ts`、新增 `src/server/telemetry/`

- [ ] 安装依赖：
  ```bash
  npm install @opentelemetry/api @opentelemetry/sdk-node \
              @opentelemetry/auto-instrumentations-node \
              @opentelemetry/exporter-trace-otlp-http
  ```
- [ ] 创建 `src/server/telemetry/tracer.ts` — OTel SDK 初始化（`NodeSDK` + auto-instrumentations）
- [ ] 在 `src/server/index.ts` 最顶部（所有 import 之前）启动 OTel SDK
- [ ] 在 `src/server/mastra/index.ts` 注入 `telemetry` 配置（`buildTelemetry()` 函数）
- [ ] `src/server/http/app.ts` 增加 OTel HTTP middleware（`@opentelemetry/instrumentation-http` 已自动覆盖，补充 requestId 注入）
- [ ] `src/server/services/image-studio.service.ts` 手动 span：`image.generate`、`image.optimize_prompt`
- [ ] `src/server/mastra/model-resolver.ts` 手动 span：`llm.resolve`
- [ ] 本地 Jaeger 验证完整 trace 链路
- [ ] 测试：发起一次 chat 请求，在 Jaeger 中确认 Agent → Tool → LLM span 全链路

**产出**：完整调用链可视化，端到端请求追踪，p99 延迟识别。

---

### Phase 3 — Metrics（3-4天）

**改动范围**：新增 `src/server/telemetry/metrics.ts`，各服务层埋点

- [ ] 安装依赖：
  ```bash
  npm install @opentelemetry/sdk-metrics \
              @opentelemetry/exporter-metrics-otlp-http
  ```
- [ ] 创建 `src/server/telemetry/metrics.ts` — MeterProvider 初始化 + 全局 meter 导出
- [ ] 在 `src/server/index.ts` 初始化 metrics（与 tracer 并列）
- [ ] `model-resolver.ts`：LLM 请求延迟 Histogram + Token Counter
- [ ] `image-studio.service.ts`：生图延迟 Histogram + 优化回退 Counter
- [ ] `http/app.ts`：HTTP 请求延迟 Histogram
- [ ] 本地 Prometheus + Grafana 验证 Dashboard
- [ ] 可选：Grafana Dashboard JSON 配置文件存入 `docs/observation/grafana-dashboard.json`

**产出**：可度量的 SLO（LLM p99 延迟、生图成功率、Token 费用估算）。

---

## 8. 关键配置与环境变量

在 `.env.example` 中新增以下变量：

```bash
# ── 可观测性配置 ──────────────────────────────────────────────
# 日志级别: debug | info | warn | error (默认 info)
LOG_LEVEL=info

# OTel 开关 (默认 true，设为 false 完全禁用)
OTEL_ENABLED=true

# OTLP 接收端地址（本地 Jaeger: http://localhost:4318）
# 不填则退化为 console exporter（仅开发环境有意义）
OTEL_EXPORTER_OTLP_ENDPOINT=

# OTLP 请求头（逗号分隔 key=value，用于 SaaS 认证）
# 示例: x-honeycomb-team=abc123,x-dataset=bloomai
OTEL_EXPORTER_OTLP_HEADERS=

# 采样率 0-1 (1 = 全量采样，生产建议 0.1-0.5)
OTEL_SAMPLING_RATIO=1
```

---

## 9. 本地开发环境搭建

### 方案 A — 仅追踪（Jaeger）

```bash
# 启动 Jaeger（all-in-one，包含 OTLP receiver）
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# .env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

访问 <http://localhost:16686>

### 方案 B — 追踪 + 指标 + 日志（Grafana LGTM）

```yaml
# docker-compose.observability.yml
version: "3.8"
services:
  # OTel Collector — 统一接收所有信号，分发到各后端
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.103.0
    command: ["--config=/etc/otel/config.yaml"]
    volumes: ["./docs/observation/otel-collector.yaml:/etc/otel/config.yaml"]
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8888:8888"   # Prometheus metrics（collector 自身）

  # Tempo — 分布式追踪存储
  tempo:
    image: grafana/tempo:latest
    command: ["-config.file=/etc/tempo.yaml"]
    volumes: ["./docs/observation/tempo.yaml:/etc/tempo.yaml"]
    ports: ["3200:3200"]

  # Prometheus — 指标存储
  prometheus:
    image: prom/prometheus:latest
    volumes: ["./docs/observation/prometheus.yaml:/etc/prometheus/prometheus.yml"]
    ports: ["9090:9090"]

  # Loki — 日志存储
  loki:
    image: grafana/loki:latest
    ports: ["3100:3100"]

  # Grafana — 统一展示层
  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes: ["./docs/observation/grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml"]
    ports: ["3000:3000"]
```

```bash
docker compose -f docker-compose.observability.yml up -d

# .env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

访问 <http://localhost:3000>（Grafana，默认无密码）。

---

## 10. 各方案对比与推荐

### 个人开发 / 调试

| 推荐 | Jaeger All-in-One |
|------|-------------------|
| 理由 | 一行 docker 启动；只关心 trace，界面直观；无需额外配置 |

### 团队开发 / CI 环境

| 推荐 | Grafana LGTM Stack（docker-compose） |
|------|--------------------------------------|
| 理由 | Traces + Metrics + Logs 三合一；Grafana 可共享 Dashboard；SigNoz 也是好的替代 |

### 生产 SaaS / 零运维

| 推荐 | Honeycomb（免费额度 2000万事件/月） |
|------|-------------------------------------|
| 理由 | Trace 体验业界最佳；BubbleUp 功能可快速定位 p99 异常根因；免运维 |

### 生产企业级

| 推荐 | Grafana Cloud 或 Datadog |
|------|--------------------------|
| 理由 | 完整 SLO/Alert/Oncall 体系；与现有基础设施对接 |

---

## 附录：文件变更索引

实施完成后，以下文件将被新增或修改：

```
src/server/
├── index.ts                          ← 修改：最顶部初始化 OTel SDK
├── logger/
│   └── index.ts                      ← 新增：createLogger 工厂
├── telemetry/                         ← 新增目录
│   ├── tracer.ts                      ← OTel TracerProvider 初始化
│   ├── metrics.ts                     ← OTel MeterProvider + 全局 meter
│   └── index.ts                       ← 统一 export
├── http/
│   └── middleware/
│       └── request-context.ts         ← 新增：requestId + OTel HTTP span
├── mastra/
│   └── index.ts                       ← 修改：注入 logger + telemetry
├── services/
│   └── image-studio.service.ts        ← 修改：手动 span 埋点
└── mastra/
    └── model-resolver.ts              ← 修改：手动 span + metrics 埋点

docs/observation/
├── observability-plan.md              ← 本文档
├── otel-collector.yaml                ← Phase 3 新增：OTel Collector 配置
├── tempo.yaml                         ← Phase 3 新增：Grafana Tempo 配置
├── prometheus.yaml                    ← Phase 3 新增：Prometheus scrape 配置
└── grafana-datasources.yaml           ← Phase 3 新增：Grafana 数据源配置
```
