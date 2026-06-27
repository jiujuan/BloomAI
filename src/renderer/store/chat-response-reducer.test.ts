import { describe, expect, it } from 'vitest'
import type { ResponseStreamEvent } from '@shared/schemas/response'
import { deriveStreamingText, deriveToolCalls, reduceStreamingResponse } from './chat-response-reducer'

describe('reduceStreamingResponse', () => {
  it('creates a streaming response and appends markdown deltas', () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response_started',
        responseId: 'response-1',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'content_block_started',
        responseId: 'response-1',
        block: {
          id: 'block-1',
          type: 'markdown',
          status: 'streaming',
          role: 'answer',
          createdAt: 2,
        },
      },
      { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'Hel' },
      { type: 'content_delta', responseId: 'response-1', blockId: 'block-1', delta: 'lo' },
      { type: 'content_block_completed', responseId: 'response-1', blockId: 'block-1', completedAt: 3 },
    ]

    const state = reduceAll(events)

    expect(state).toEqual({
      responseId: 'response-1',
      sessionId: 'session-1',
      blocks: [
        {
          id: 'block-1',
          type: 'markdown',
          status: 'completed',
          role: 'answer',
          markdown: 'Hello',
          createdAt: 2,
          completedAt: 3,
        },
      ],
      isComplete: false,
    })
  })

  it('updates tool call blocks to success and error states', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-2',
        sessionId: 'session-1',
        runtime: 'agent-runtime',
        createdAt: 1,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-2',
        block: {
          id: 'tool-block-1',
          type: 'tool_call',
          callId: 'call-1',
          toolId: 'web_search',
          category: 'web',
          status: 'running',
          input: { query: 'BloomAI' },
          createdAt: 2,
        },
      },
      {
        type: 'tool_call_completed',
        responseId: 'response-2',
        callId: 'call-1',
        output: { results: [{ title: 'BloomAI' }] },
        outputSummary: '1 results',
        durationMs: 12,
        completedAt: 3,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-2',
        block: {
          id: 'tool-block-2',
          type: 'tool_call',
          callId: 'call-2',
          toolId: 'shell_exec',
          category: 'shell',
          status: 'running',
          input: { command: 'npm test' },
          createdAt: 4,
        },
      },
      {
        type: 'tool_call_failed',
        responseId: 'response-2',
        callId: 'call-2',
        error: { code: 'TOOL_CALL_ERROR', message: 'denied' },
        durationMs: 5,
        completedAt: 5,
      },
    ])

    expect(state?.blocks).toEqual([
      {
        id: 'tool-block-1',
        type: 'tool_call',
        callId: 'call-1',
        toolId: 'web_search',
        category: 'web',
        status: 'success',
        input: { query: 'BloomAI' },
        output: { results: [{ title: 'BloomAI' }] },
        outputSummary: '1 results',
        durationMs: 12,
        createdAt: 2,
        completedAt: 3,
      },
      {
        id: 'tool-block-2',
        type: 'tool_call',
        callId: 'call-2',
        toolId: 'shell_exec',
        category: 'shell',
        status: 'error',
        input: { command: 'npm test' },
        error: { code: 'TOOL_CALL_ERROR', message: 'denied' },
        durationMs: 5,
        createdAt: 4,
        completedAt: 5,
      },
    ])
  })

  it('stores usage and marks the response complete', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-3',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'usage_updated',
        responseId: 'response-3',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      },
      {
        type: 'response_completed',
        responseId: 'response-3',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        finishReason: 'stop',
        completedAt: 2,
      },
    ])

    expect(state).toMatchObject({
      responseId: 'response-3',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      isComplete: true,
    })
  })

  it('marks failures complete and appends an error block', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-4',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'response_failed',
        responseId: 'response-4',
        error: { code: 'AGENT_RUNTIME_ERROR', message: 'failed' },
        completedAt: 2,
      },
    ])

    expect(state).toEqual({
      responseId: 'response-4',
      sessionId: 'session-1',
      blocks: [
        {
          id: 'response-4-error',
          type: 'error',
          status: 'failed',
          error: { code: 'AGENT_RUNTIME_ERROR', message: 'failed' },
          createdAt: 2,
          completedAt: 2,
        },
      ],
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'failed' },
      isComplete: true,
    })
  })

  it('applies tool call delta status messages and metadata patches', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-5',
        sessionId: 'session-1',
        runtime: 'agent-runtime',
        createdAt: 1,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-5',
        block: {
          id: 'tool-block-1',
          type: 'tool_call',
          callId: 'call-1',
          toolId: 'web_search',
          category: 'web',
          status: 'running',
          input: { query: 'BloomAI' },
          createdAt: 2,
        },
      },
      {
        type: 'tool_call_delta',
        responseId: 'response-5',
        callId: 'call-1',
        patch: {
          statusMessage: 'Searching docs',
          outputSummary: '2 partial results',
          metadata: { page: 1 },
        },
      },
    ])

    expect(state?.blocks[0]).toMatchObject({
      type: 'tool_call',
      outputSummary: '2 partial results',
      metadata: { page: 1, statusMessage: 'Searching docs' },
    })
  })

  it('marks running tools as interrupted when the response fails', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-6',
        sessionId: 'session-1',
        runtime: 'agent-runtime',
        createdAt: 1,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-6',
        block: {
          id: 'tool-block-1',
          type: 'tool_call',
          callId: 'call-1',
          toolId: 'web_search',
          category: 'web',
          status: 'running',
          input: { query: 'BloomAI' },
          createdAt: 2,
        },
      },
      {
        type: 'response_failed',
        responseId: 'response-6',
        error: { code: 'STREAM_ABORTED', message: 'aborted' },
        completedAt: 3,
      },
    ])

    expect(state?.blocks[0]).toMatchObject({
      type: 'tool_call',
      status: 'error',
      error: { code: 'STREAM_ABORTED', message: 'aborted' },
      metadata: { interrupted: true },
      completedAt: 3,
    })
    expect(deriveToolCalls(state)[0]).toMatchObject({
      status: 'error',
      error: 'aborted',
      interrupted: true,
    })
  })

  it('reduces skill calls as ordinary tool blocks', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-skill',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'tool_call_started',
        responseId: 'response-skill',
        block: {
          id: 'skill-block-1',
          type: 'tool_call',
          callId: 'skill-call-1',
          toolId: 'skill:writer',
          category: 'tool',
          status: 'running',
          input: { topic: 'launch' },
          createdAt: 2,
        },
      },
      {
        type: 'tool_call_completed',
        responseId: 'response-skill',
        callId: 'skill-call-1',
        output: { draft: 'done' },
        outputSummary: 'Skill completed',
        durationMs: 9,
        completedAt: 3,
      },
    ])

    expect(state?.blocks).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        callId: 'skill-call-1',
        toolId: 'skill:writer',
        category: 'tool',
        status: 'success',
        outputSummary: 'Skill completed',
      }),
    ])
    expect(deriveToolCalls(state)).toEqual([
      expect.objectContaining({
        callId: 'skill-call-1',
        toolId: 'skill:writer',
        category: 'tool',
        status: 'success',
      }),
    ])
  })

  it('preserves partial markdown in response blocks after failure', () => {
    const state = reduceAll([
      {
        type: 'response_started',
        responseId: 'response-7',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        createdAt: 1,
      },
      {
        type: 'content_block_started',
        responseId: 'response-7',
        block: { id: 'block-1', type: 'markdown', status: 'streaming', role: 'answer', createdAt: 2 },
      },
      { type: 'content_delta', responseId: 'response-7', blockId: 'block-1', delta: 'partial' },
      {
        type: 'response_failed',
        responseId: 'response-7',
        error: { code: 'AGENT_RUNTIME_ERROR', message: 'failed' },
        completedAt: 3,
      },
    ])

    expect(deriveStreamingText(state)).toBe('partial')
    expect(state?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'markdown', markdown: 'partial' }),
      expect.objectContaining({ type: 'error', error: { code: 'AGENT_RUNTIME_ERROR', message: 'failed' } }),
    ]))
  })
})

function reduceAll(events: ResponseStreamEvent[]) {
  return events.reduce(
    (current, event) => reduceStreamingResponse(current, event, 'session-1'),
    null as ReturnType<typeof reduceStreamingResponse>,
  )
}
