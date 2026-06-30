// Self-contained error-code → timeline presentation map. This is the only part of
// the former bloom-response-v1 contract still in use (by the server logger and,
// optionally, the chat UI). ResponseError is defined here to avoid depending on the
// removed response stream schema.
export type ResponseError = {
  code: string
  message: string
  details?: unknown
}

export type KnownResponseErrorCode =
  | 'VALIDATION_ERROR'
  | 'LLM_CONFIG_ERROR'
  | 'LLM_PROVIDER_ERROR'
  | 'LLM_RESPONSE_PARSE_ERROR'
  | 'TOOL_CALL_ERROR'
  | 'AGENT_RUNTIME_ERROR'
  | 'STREAM_ABORTED'
  | 'UNKNOWN_ERROR'

export type TimelineErrorSeverity = 'info' | 'warning' | 'error'
export type TimelineErrorCanContinue = boolean | 'depends'

export type ErrorTimelineDefinition = {
  severity: TimelineErrorSeverity
  timelineMessage: string
  groupBehavior: string
  canContinue: TimelineErrorCanContinue
  logLevel: 'info' | 'warn' | 'error'
}

export const ERROR_TIMELINE_REGISTRY = {
  VALIDATION_ERROR: {
    severity: 'warning',
    timelineMessage: '输入参数错误',
    groupBehavior: 'none',
    canContinue: false,
    logLevel: 'warn',
  },
  LLM_CONFIG_ERROR: {
    severity: 'error',
    timelineMessage: '模型配置错误',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'error',
  },
  LLM_PROVIDER_ERROR: {
    severity: 'error',
    timelineMessage: '大模型调用失败',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'error',
  },
  LLM_RESPONSE_PARSE_ERROR: {
    severity: 'error',
    timelineMessage: '模型响应解析失败',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'error',
  },
  TOOL_CALL_ERROR: {
    severity: 'error',
    timelineMessage: '工具执行失败',
    groupBehavior: 'mark_related_group_failed',
    canContinue: 'depends',
    logLevel: 'error',
  },
  AGENT_RUNTIME_ERROR: {
    severity: 'error',
    timelineMessage: 'Agent 执行失败',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'error',
  },
  STREAM_ABORTED: {
    severity: 'warning',
    timelineMessage: '回答已中断',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'warn',
  },
  UNKNOWN_ERROR: {
    severity: 'error',
    timelineMessage: '发生未知错误',
    groupBehavior: 'interrupt_running_groups',
    canContinue: false,
    logLevel: 'error',
  },
} as const satisfies Record<KnownResponseErrorCode, ErrorTimelineDefinition>

export function isKnownResponseErrorCode(code: string): code is KnownResponseErrorCode {
  return code in ERROR_TIMELINE_REGISTRY
}

export function resolveErrorTimeline(error: ResponseError): ErrorTimelineDefinition {
  if (isKnownResponseErrorCode(error.code)) {
    return ERROR_TIMELINE_REGISTRY[error.code]
  }
  return ERROR_TIMELINE_REGISTRY.UNKNOWN_ERROR
}
