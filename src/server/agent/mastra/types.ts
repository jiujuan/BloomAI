export type ChatAgentRunInput = {
  sessionId: string
  content: string
  model: string
  maxSteps?: number
}

export type ChatToolCallTrace = {
  callId: string
  toolId: string
  status: 'success' | 'error'
  input?: unknown
  outputSummary?: string
  durationMs?: number
}

export type ChatAgentTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  [key: string]: unknown
}

export type ChatAgentRunTrace = {
  runtime: 'mastra-chat-agent-v1'
  maxSteps: number
  toolCalls: ChatToolCallTrace[]
  tokens?: ChatAgentTokenUsage
}

export type ToolCallViewModel = {
  callId: string
  toolId: string
  category: string
  status: 'running' | 'success' | 'error'
  input: Record<string, unknown>
  output?: unknown
  error?: string
  durationMs?: number
}

export type ToolCallDeltaPatch = {
  outputSummary?: string
  durationMs?: number
  statusMessage?: string
  metadata?: Record<string, unknown>
}

export type ChatAgentRuntimeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: ToolCallViewModel }
  | { type: 'tool_call_delta'; callId: string; patch: ToolCallDeltaPatch }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; trace: ChatAgentRunTrace }
  | { type: 'error'; error: string }
