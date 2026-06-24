export type MastraModelResolution =
  | { ok: true; model: string }
  | { ok: false; modelId: string; reason: string }

export type ChatAgentToolDescriptor = {
  id: string
  description: string
}

export type ChatAgentDescriptor = {
  id: string
  name: string
  instructions: string
  model: string
  tools: {
    web_search: ChatAgentToolDescriptor
  }
}

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

export type ChatAgentRunTrace = {
  runtime: 'mastra-chat-agent-v1'
  maxSteps: number
  toolCalls: ChatToolCallTrace[]
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

export type ChatAgentRuntimeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call_start'; call: ToolCallViewModel }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs?: number }
  | { type: 'tool_call_error'; callId: string; error: string }
  | { type: 'done'; trace: ChatAgentRunTrace }
  | { type: 'error'; error: string }
