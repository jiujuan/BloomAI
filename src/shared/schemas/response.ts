import { z } from 'zod'

export const RESPONSE_SCHEMA_VERSION = 'bloom-response-v1' as const

export type ResponseRuntime =
  | 'direct-llm'
  | 'mastra-chat-agent-v1'
  | 'agent-runtime'
  | 'workflow'

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_limit'
  | 'error'
  | 'cancelled'
  | 'unknown'

export type ResponseError = {
  code: string
  message: string
  details?: unknown
}

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  provider?: string
  model?: string
}

export type ToolPermissionView = {
  level: 'network' | 'write' | 'shell'
  status: 'not_required' | 'pending' | 'granted' | 'denied'
  scope?: 'once' | 'session' | 'always'
}

export type BaseBlockFields = {
  id: string
  createdAt: number
  completedAt?: number
}

export type MarkdownBlock = BaseBlockFields & {
  type: 'markdown'
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  markdown: string
  role?: 'answer' | 'reasoning_summary' | 'notice'
}

export type ToolCallBlock = BaseBlockFields & {
  type: 'tool_call'
  callId: string
  toolId: string
  title?: string
  category: 'search' | 'web' | 'file' | 'shell' | 'image' | 'video' | 'tool'
  status: 'running' | 'success' | 'error'
  input: Record<string, unknown>
  output?: unknown
  outputSummary?: string
  error?: ResponseError
  durationMs?: number
  permission?: ToolPermissionView
  metadata?: Record<string, unknown>
}

export type ArtifactBlock = BaseBlockFields & {
  type: 'artifact'
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  artifactId: string
  title: string
  artifactType: 'file' | 'image' | 'video' | 'code' | 'document' | 'data'
  mimeType?: string
  uri?: string
  localPath?: string
  preview?: string
  metadata?: Record<string, unknown>
}

export type Citation = {
  id: string
  title?: string
  url?: string
  sourceType: 'web' | 'file' | 'document' | 'tool' | 'unknown'
  snippet?: string
  metadata?: Record<string, unknown>
}

export type CitationBlock = BaseBlockFields & {
  type: 'citation'
  status: 'completed'
  citations: Citation[]
}

export type ErrorBlock = BaseBlockFields & {
  type: 'error'
  status: 'failed'
  error: ResponseError
  recoverable?: boolean
}

export type ResponseContentBlock =
  | MarkdownBlock
  | ToolCallBlock
  | ArtifactBlock
  | CitationBlock
  | ErrorBlock

export type ToolCallTrace = {
  callId: string
  toolId: string
  status: 'success' | 'error'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}

export type ResponseTrace = {
  schemaVersion?: typeof RESPONSE_SCHEMA_VERSION
  runtime: ResponseRuntime
  runId?: string
  providerId?: string
  model?: string
  maxSteps?: number
  toolCalls?: ToolCallTrace[]
  finishReason?: FinishReason
  metadata?: Record<string, unknown>
}

export type ResponseEnvelope = {
  schemaVersion: typeof RESPONSE_SCHEMA_VERSION
  responseId: string
  sessionId?: string
  messageId?: string
  role: 'assistant'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  blocks: ResponseContentBlock[]
  usage?: TokenUsage
  trace?: ResponseTrace
  error?: ResponseError
  createdAt: number
  completedAt?: number
}

export type ResponseStartedEvent = {
  type: 'response_started'
  responseId: string
  sessionId?: string
  runtime: ResponseRuntime
  providerId?: string
  model?: string
  createdAt: number
}

export type ContentBlockStartedEvent = {
  type: 'content_block_started'
  responseId: string
  block: Omit<MarkdownBlock, 'markdown' | 'completedAt'> & { markdown?: string }
}

export type ContentDeltaEvent = {
  type: 'content_delta'
  responseId: string
  blockId: string
  delta: string
}

export type ContentBlockCompletedEvent = {
  type: 'content_block_completed'
  responseId: string
  blockId: string
  completedAt: number
}

export type ToolCallStartedEvent = {
  type: 'tool_call_started'
  responseId: string
  block: ToolCallBlock
}

export type ToolCallDeltaEvent = {
  type: 'tool_call_delta'
  responseId: string
  callId: string
  patch: Partial<Pick<ToolCallBlock, 'outputSummary' | 'durationMs' | 'permission' | 'metadata'>> & {
    statusMessage?: string
  }
}

export type ToolCallCompletedEvent = {
  type: 'tool_call_completed'
  responseId: string
  callId: string
  output?: unknown
  outputSummary?: string
  durationMs?: number
  completedAt: number
}

export type ToolCallFailedEvent = {
  type: 'tool_call_failed'
  responseId: string
  callId: string
  error: ResponseError
  durationMs?: number
  completedAt: number
}

export type UsageUpdatedEvent = {
  type: 'usage_updated'
  responseId: string
  usage: TokenUsage
}

export type ResponseCompletedEvent = {
  type: 'response_completed'
  responseId: string
  messageId?: string
  usage?: TokenUsage
  trace?: ResponseTrace
  finishReason: FinishReason
  completedAt: number
}

export type ResponseFailedEvent = {
  type: 'response_failed'
  responseId: string
  error: ResponseError
  completedAt: number
}

export type ResponseStreamEvent =
  | ResponseStartedEvent
  | ContentBlockStartedEvent
  | ContentDeltaEvent
  | ContentBlockCompletedEvent
  | ToolCallStartedEvent
  | ToolCallDeltaEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | UsageUpdatedEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent

export const ResponseErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const TokenUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
})

const ToolPermissionViewSchema = z.object({
  level: z.enum(['network', 'write', 'shell']),
  status: z.enum(['not_required', 'pending', 'granted', 'denied']),
  scope: z.enum(['once', 'session', 'always']).optional(),
})

const MarkdownBlockStartSchema = z.object({
  id: z.string(),
  type: z.literal('markdown'),
  status: z.enum(['pending', 'streaming', 'completed', 'failed']),
  role: z.enum(['answer', 'reasoning_summary', 'notice']).optional(),
  markdown: z.string().optional(),
  createdAt: z.number(),
})

const ToolCallBlockSchema = z.object({
  id: z.string(),
  type: z.literal('tool_call'),
  callId: z.string(),
  toolId: z.string(),
  title: z.string().optional(),
  category: z.enum(['search', 'web', 'file', 'shell', 'image', 'video', 'tool']),
  status: z.enum(['running', 'success', 'error']),
  input: z.record(z.unknown()),
  output: z.unknown().optional(),
  outputSummary: z.string().optional(),
  error: ResponseErrorSchema.optional(),
  durationMs: z.number().optional(),
  permission: ToolPermissionViewSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
})

export const ResponseStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('response_started'),
    responseId: z.string(),
    sessionId: z.string().optional(),
    runtime: z.enum(['direct-llm', 'mastra-chat-agent-v1', 'agent-runtime', 'workflow']),
    providerId: z.string().optional(),
    model: z.string().optional(),
    createdAt: z.number(),
  }),
  z.object({
    type: z.literal('content_block_started'),
    responseId: z.string(),
    block: MarkdownBlockStartSchema,
  }),
  z.object({
    type: z.literal('content_delta'),
    responseId: z.string(),
    blockId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('content_block_completed'),
    responseId: z.string(),
    blockId: z.string(),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('tool_call_started'),
    responseId: z.string(),
    block: ToolCallBlockSchema,
  }),
  z.object({
    type: z.literal('tool_call_delta'),
    responseId: z.string(),
    callId: z.string(),
    patch: z.object({
      outputSummary: z.string().optional(),
      durationMs: z.number().optional(),
      permission: ToolPermissionViewSchema.optional(),
      statusMessage: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  z.object({
    type: z.literal('tool_call_completed'),
    responseId: z.string(),
    callId: z.string(),
    output: z.unknown().optional(),
    outputSummary: z.string().optional(),
    durationMs: z.number().optional(),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('tool_call_failed'),
    responseId: z.string(),
    callId: z.string(),
    error: ResponseErrorSchema,
    durationMs: z.number().optional(),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('usage_updated'),
    responseId: z.string(),
    usage: TokenUsageSchema,
  }),
  z.object({
    type: z.literal('response_completed'),
    responseId: z.string(),
    messageId: z.string().optional(),
    usage: TokenUsageSchema.optional(),
    trace: z.unknown().optional(),
    finishReason: z.enum(['stop', 'length', 'tool_limit', 'error', 'cancelled', 'unknown']),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('response_failed'),
    responseId: z.string(),
    error: ResponseErrorSchema,
    completedAt: z.number(),
  }),
])
