export type TimelineAssistantBubbleMode =
  | 'hidden'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'preserve'
  | 'preserve_or_stream'

export type TimelineToolGroupStatus =
  | 'none'
  | 'running'
  | 'success'
  | 'error'
  | 'partial_error'
  | 'interrupted'

export type TimelineStateKey =
  | 'response_started_no_block'
  | 'markdown_streaming'
  | 'tool_running'
  | 'tool_soft_failed'
  | 'tool_hard_failed'
  | 'response_completed'
  | 'response_failed_before_content'
  | 'response_failed_after_content'
  | 'stream_aborted'
  | 'persistence_failed_after_stream'

export type TimelineStateDefinition = {
  label: string
  assistantBubble: TimelineAssistantBubbleMode
  toolGroupStatus: TimelineToolGroupStatus
  visibleError: boolean
  description: string
}

export const TIMELINE_STATE_REGISTRY = {
  response_started_no_block: {
    label: '正在思考',
    assistantBubble: 'hidden',
    toolGroupStatus: 'none',
    visibleError: false,
    description: 'response_started has arrived, but no renderable block exists yet.',
  },
  markdown_streaming: {
    label: '正在生成回答',
    assistantBubble: 'streaming',
    toolGroupStatus: 'none',
    visibleError: false,
    description: 'A markdown block is streaming content.',
  },
  tool_running: {
    label: '正在执行工具',
    assistantBubble: 'preserve',
    toolGroupStatus: 'running',
    visibleError: false,
    description: 'One or more tool calls are running.',
  },
  tool_soft_failed: {
    label: '工具执行失败，继续尝试回答',
    assistantBubble: 'preserve_or_stream',
    toolGroupStatus: 'partial_error',
    visibleError: true,
    description: 'A tool failed, but the Agent can continue generating an answer.',
  },
  tool_hard_failed: {
    label: '工具执行失败，无法完成回答',
    assistantBubble: 'error',
    toolGroupStatus: 'error',
    visibleError: true,
    description: 'A required tool failed and the whole response fails.',
  },
  response_completed: {
    label: '回答完成',
    assistantBubble: 'completed',
    toolGroupStatus: 'success',
    visibleError: false,
    description: 'The response completed successfully.',
  },
  response_failed_before_content: {
    label: '回答生成失败',
    assistantBubble: 'error',
    toolGroupStatus: 'interrupted',
    visibleError: true,
    description: 'The response failed before any assistant content was available.',
  },
  response_failed_after_content: {
    label: '回答中断，已保留部分内容',
    assistantBubble: 'preserve',
    toolGroupStatus: 'interrupted',
    visibleError: true,
    description: 'The response failed after partial assistant content was already visible.',
  },
  stream_aborted: {
    label: '回答已中断',
    assistantBubble: 'preserve',
    toolGroupStatus: 'interrupted',
    visibleError: true,
    description: 'The user cancelled the request or the stream disconnected.',
  },
  persistence_failed_after_stream: {
    label: '回答已生成，但保存失败',
    assistantBubble: 'completed',
    toolGroupStatus: 'success',
    visibleError: true,
    description: 'The frontend received the response, but persistence failed after streaming.',
  },
} as const satisfies Record<TimelineStateKey, TimelineStateDefinition>

export function getTimelineStateDefinition(key: TimelineStateKey): TimelineStateDefinition {
  return TIMELINE_STATE_REGISTRY[key]
}
