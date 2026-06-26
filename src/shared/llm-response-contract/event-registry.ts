import type { ResponseStreamEvent } from '../schemas/response'

export const RESPONSE_EVENT_TYPES = [
  'response_started',
  'content_block_started',
  'content_delta',
  'content_block_completed',
  'tool_call_started',
  'tool_call_delta',
  'tool_call_completed',
  'tool_call_failed',
  'usage_updated',
  'response_completed',
  'response_failed',
] as const satisfies readonly ResponseStreamEvent['type'][]

export type ResponseEventType = ResponseStreamEvent['type']

export type ResponseEventDefinition = {
  producer: readonly string[]
  requiredFields: readonly string[]
  stateTransition: string
  timelineDescription: string
  groupBehavior: string
  persistence: string
  failureSemantics: string
}

export const RESPONSE_EVENT_REGISTRY = {
  response_started: {
    producer: ['LLM mapper', 'Agent mapper', 'normalizer'],
    requiredFields: ['responseId', 'runtime', 'createdAt'],
    stateTransition: 'Create streaming response state.',
    timelineDescription: '显示正在准备回答或正在思考的占位状态；没有正文时不创建空 assistant 气泡。',
    groupBehavior: 'none',
    persistence: 'Record response start time and runtime metadata.',
    failureSemantics: 'If the response fails later, response_failed must close the response.',
  },
  content_block_started: {
    producer: ['LLM mapper', 'Agent mapper'],
    requiredFields: ['responseId', 'block.id', 'block.type'],
    stateTransition: 'Append a markdown block.',
    timelineDescription: '创建 assistant streaming 气泡。',
    groupBehavior: 'none',
    persistence: 'Subsequent content_delta events accumulate into messages.content.',
    failureSemantics: 'If the response fails before completion, keep partial markdown visible.',
  },
  content_delta: {
    producer: ['LLM mapper', 'Agent mapper'],
    requiredFields: ['responseId', 'blockId', 'delta'],
    stateTransition: 'Append markdown delta to the target block.',
    timelineDescription: '实时追加正文。',
    groupBehavior: 'none',
    persistence: 'Accumulate as assistant readable text.',
    failureSemantics: 'Partial content remains displayable if a later response_failed arrives.',
  },
  content_block_completed: {
    producer: ['LLM mapper', 'Agent mapper'],
    requiredFields: ['responseId', 'blockId', 'completedAt'],
    stateTransition: 'Mark markdown block completed.',
    timelineDescription: '停止该正文块的 streaming cursor。',
    groupBehavior: 'none',
    persistence: 'Mark content block completion in the streaming snapshot.',
    failureSemantics: 'Does not close the whole response.',
  },
  tool_call_started: {
    producer: ['Agent mapper', 'normalizer'],
    requiredFields: ['responseId', 'block.callId', 'block.toolId', 'block.category', 'block.status'],
    stateTransition: 'Append a running tool call block.',
    timelineDescription: '显示工具卡片 running，例如正在搜索 Web。',
    groupBehavior: 'Adjacent tool calls with the same category:toolId join one group card.',
    persistence: 'Create tool trace draft.',
    failureSemantics: 'The tool call is pending until tool_call_completed or tool_call_failed.',
  },
  tool_call_delta: {
    producer: ['Agent mapper', 'tool runner'],
    requiredFields: ['responseId', 'callId', 'patch'],
    stateTransition: 'Patch a running tool call block.',
    timelineDescription: '更新进度、权限等待、fallback 说明或结果数量等短描述。',
    groupBehavior: 'Update the matching row or status section inside its group.',
    persistence: 'May record stage summaries; raw output should not be persisted from this event.',
    failureSemantics: 'Does not change the final tool call status.',
  },
  tool_call_completed: {
    producer: ['Agent mapper', 'tool runner'],
    requiredFields: ['responseId', 'callId', 'completedAt'],
    stateTransition: 'Mark tool call success.',
    timelineDescription: '工具卡片显示完成、耗时、摘要或 Top results。',
    groupBehavior: 'Contributes success status to the containing group.',
    persistence: 'Write success tool trace into ResponseTrace.toolCalls.',
    failureSemantics: 'Tool success does not mean the Agent response is complete.',
  },
  tool_call_failed: {
    producer: ['Agent mapper', 'tool runner'],
    requiredFields: ['responseId', 'callId', 'error', 'completedAt'],
    stateTransition: 'Mark tool call error.',
    timelineDescription: '工具卡片显示失败原因。',
    groupBehavior: 'Contributes failed or partial failed status to the containing group.',
    persistence: 'Write failed tool trace and error log.',
    failureSemantics: 'Soft failures may continue to content; hard failures must be followed by response_failed.',
  },
  usage_updated: {
    producer: ['LLM mapper', 'Agent mapper'],
    requiredFields: ['responseId', 'usage'],
    stateTransition: 'Update response token usage.',
    timelineDescription: '默认不展示，可在 debug 或 message meta 中展示。',
    groupBehavior: 'none',
    persistence: 'Persist total token count when available.',
    failureSemantics: 'Has no direct success or failure meaning.',
  },
  response_completed: {
    producer: ['LLM mapper', 'Agent mapper', 'writer'],
    requiredFields: ['responseId', 'finishReason', 'completedAt'],
    stateTransition: 'Mark streaming response completed.',
    timelineDescription: '停止全局等待状态，显示最终 assistant 正文和完成的工具分组。',
    groupBehavior: 'All running groups should already be completed, failed, or treated as interrupted.',
    persistence: 'Persist messages.content, messages.tool_calls, and tokens.',
    failureSemantics: 'Closes the response successfully.',
  },
  response_failed: {
    producer: ['LLM mapper', 'Agent mapper', 'writer', 'normalizer'],
    requiredFields: ['responseId', 'error', 'completedAt'],
    stateTransition: 'Mark streaming response failed and append an error block.',
    timelineDescription: '显示可读错误；如果没有正文，也要显示错误信息，不能出现空气泡。',
    groupBehavior: 'Treat remaining running groups as interrupted.',
    persistence: 'Write error log; partial content may be persisted with error trace.',
    failureSemantics: 'Closes the response as failed; 不得再发送 content 或 tool events。',
  },
} as const satisfies Record<ResponseEventType, ResponseEventDefinition>

export function getResponseEventDefinition(type: ResponseEventType): ResponseEventDefinition {
  return RESPONSE_EVENT_REGISTRY[type]
}
