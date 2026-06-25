import type {
  ErrorBlock,
  MarkdownBlock,
  ResponseContentBlock,
  ResponseError,
  ResponseStreamEvent,
  TokenUsage,
  ToolCallBlock,
} from '@shared/schemas/response'

export type StreamingResponseState = {
  responseId: string
  sessionId: string
  blocks: ResponseContentBlock[]
  usage?: TokenUsage
  error?: ResponseError
  isComplete: boolean
}

export function reduceStreamingResponse(
  current: StreamingResponseState | null,
  event: ResponseStreamEvent,
  sessionId: string,
): StreamingResponseState | null {
  if (event.type === 'response_started') {
    return {
      responseId: event.responseId,
      sessionId: event.sessionId ?? sessionId,
      blocks: [],
      isComplete: false,
    }
  }

  if (!current) return null

  if (event.responseId !== current.responseId) return current

  if (event.type === 'content_block_started') {
    const block: MarkdownBlock = {
      ...event.block,
      markdown: event.block.markdown ?? '',
    }
    return appendBlock(current, block)
  }

  if (event.type === 'content_delta') {
    return updateBlock(current, event.blockId, (block) => {
      if (block.type !== 'markdown') return block
      return { ...block, markdown: block.markdown + event.delta }
    })
  }

  if (event.type === 'content_block_completed') {
    return updateBlock(current, event.blockId, (block) => {
      if (block.type !== 'markdown') return block
      return { ...block, status: 'completed', completedAt: event.completedAt }
    })
  }

  if (event.type === 'tool_call_started') {
    return appendBlock(current, event.block)
  }

  if (event.type === 'tool_call_delta') {
    return updateToolCall(current, event.callId, (block) => ({ ...block, ...event.patch }))
  }

  if (event.type === 'tool_call_completed') {
    return updateToolCall(current, event.callId, (block) => ({
      ...block,
      status: 'success',
      output: event.output,
      outputSummary: event.outputSummary,
      durationMs: event.durationMs ?? block.durationMs,
      completedAt: event.completedAt,
    }))
  }

  if (event.type === 'tool_call_failed') {
    return updateToolCall(current, event.callId, (block) => ({
      ...block,
      status: 'error',
      error: event.error,
      durationMs: event.durationMs ?? block.durationMs,
      completedAt: event.completedAt,
    }))
  }

  if (event.type === 'usage_updated') {
    return { ...current, usage: event.usage }
  }

  if (event.type === 'response_completed') {
    return {
      ...current,
      usage: event.usage ?? current.usage,
      isComplete: true,
    }
  }

  if (event.type === 'response_failed') {
    const errorBlock: ErrorBlock = {
      id: `${event.responseId}-error`,
      type: 'error',
      status: 'failed',
      error: event.error,
      createdAt: event.completedAt,
      completedAt: event.completedAt,
    }
    return {
      ...appendBlock(current, errorBlock),
      error: event.error,
      isComplete: true,
    }
  }

  return current
}

function appendBlock(state: StreamingResponseState, block: ResponseContentBlock): StreamingResponseState {
  return {
    ...state,
    blocks: [...state.blocks, block],
  }
}

function updateBlock(
  state: StreamingResponseState,
  blockId: string,
  update: (block: ResponseContentBlock) => ResponseContentBlock,
): StreamingResponseState {
  return {
    ...state,
    blocks: state.blocks.map((block) => block.id === blockId ? update(block) : block),
  }
}

function updateToolCall(
  state: StreamingResponseState,
  callId: string,
  update: (block: ToolCallBlock) => ToolCallBlock,
): StreamingResponseState {
  return {
    ...state,
    blocks: state.blocks.map((block) => {
      if (block.type !== 'tool_call' || block.callId !== callId) return block
      return update(block)
    }),
  }
}
