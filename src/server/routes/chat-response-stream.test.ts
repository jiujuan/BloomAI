import type { Response } from 'express'
import { describe, expect, it } from 'vitest'
import { RESPONSE_SCHEMA_VERSION, type ResponseStreamEvent } from '@shared/schemas/response'
import { createChatResponseStreamWriter } from './chat-response-stream'

function createWriter() {
  const sent: unknown[] = []
  const writer = createChatResponseStreamWriter({
    res: {} as Response,
    sessionId: 'session-1',
    sendSSE: (_res, payload) => {
      sent.push(payload)
    },
  })

  return { sent, writer }
}

describe('createChatResponseStreamWriter', () => {
  it('sends active agent runtime events unchanged and accumulates markdown text and usage', () => {
    const { sent, writer } = createWriter()
    const events: ResponseStreamEvent[] = [
      {
        type: 'response_started',
        responseId: 'response-1',
        sessionId: 'session-1',
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
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
      {
        type: 'usage_updated',
        responseId: 'response-1',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, model: 'gpt-4o' },
      },
      {
        type: 'response_completed',
        responseId: 'response-1',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, model: 'gpt-4o' },
        trace: {
          schemaVersion: RESPONSE_SCHEMA_VERSION,
          runtime: 'mastra-chat-agent-v1',
          model: 'gpt-4o',
          finishReason: 'stop',
        },
        finishReason: 'stop',
        completedAt: 3,
      },
    ]

    for (const event of events) writer.send(event)

    expect(sent).toEqual(events)
    expect(writer.state()).toEqual({
      responseId: 'response-1',
      text: 'Hello',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, model: 'gpt-4o' },
      trace: {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        finishReason: 'stop',
        toolCalls: [],
      },
      toolCalls: [],
    })
  })

  it('accumulates tool call success and merges completed trace metadata', () => {
    const { writer } = createWriter()

    writer.send({
      type: 'response_started',
      responseId: 'response-2',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      model: 'gpt-4o',
      createdAt: 1,
    })
    writer.send({
      type: 'tool_call_started',
      responseId: 'response-2',
      block: {
        id: 'tool-block-1',
        type: 'tool_call',
        callId: 'call-1',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'Mastra' },
        createdAt: 2,
      },
    })
    writer.send({
      type: 'tool_call_completed',
      responseId: 'response-2',
      callId: 'call-1',
      output: { results: [{ title: 'Result' }] },
      outputSummary: '1 results',
      durationMs: 12,
      completedAt: 3,
    })
    writer.send({
      type: 'response_completed',
      responseId: 'response-2',
      trace: {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        maxSteps: 10,
        finishReason: 'stop',
      },
      finishReason: 'stop',
      completedAt: 4,
    })

    expect(writer.state().toolCalls).toEqual([
      {
        callId: 'call-1',
        toolId: 'web_search',
        status: 'success',
        input: { query: 'Mastra' },
        outputSummary: '1 results',
        durationMs: 12,
      },
    ])
    expect(writer.state().trace).toEqual({
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      runtime: 'mastra-chat-agent-v1',
      model: 'gpt-4o',
      maxSteps: 10,
      finishReason: 'stop',
      toolCalls: [
        {
          callId: 'call-1',
          toolId: 'web_search',
          status: 'success',
          input: { query: 'Mastra' },
          outputSummary: '1 results',
          durationMs: 12,
        },
      ],
    })
  })

  it('accumulates skill tool calls into the persisted agent trace', () => {
    const { writer } = createWriter()

    writer.send({
      type: 'response_started',
      responseId: 'response-skill',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      model: 'gpt-4o',
      createdAt: 1,
    })
    writer.send({
      type: 'tool_call_started',
      responseId: 'response-skill',
      block: {
        id: 'skill-block-1',
        type: 'tool_call',
        callId: 'skill-call-1',
        toolId: 'skill:summarizer',
        category: 'tool',
        status: 'running',
        input: { text: 'Long note' },
        createdAt: 2,
      },
    })
    writer.send({
      type: 'tool_call_completed',
      responseId: 'response-skill',
      callId: 'skill-call-1',
      output: { summary: 'Short note' },
      outputSummary: 'Short note',
      durationMs: 9,
      completedAt: 3,
    })
    writer.send({
      type: 'response_completed',
      responseId: 'response-skill',
      trace: {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        runtime: 'mastra-chat-agent-v1',
        model: 'gpt-4o',
        maxSteps: 10,
        finishReason: 'stop',
      },
      finishReason: 'stop',
      completedAt: 4,
    })

    expect(writer.state().trace).toEqual({
      schemaVersion: RESPONSE_SCHEMA_VERSION,
      runtime: 'mastra-chat-agent-v1',
      model: 'gpt-4o',
      maxSteps: 10,
      finishReason: 'stop',
      toolCalls: [
        {
          callId: 'skill-call-1',
          toolId: 'skill:summarizer',
          status: 'success',
          input: { text: 'Long note' },
          outputSummary: 'Short note',
          durationMs: 9,
        },
      ],
    })
  })
  it('marks failed tool calls and keeps failed response partial state', () => {
    const { writer } = createWriter()

    writer.send({
      type: 'response_started',
      responseId: 'response-3',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      createdAt: 1,
    })
    writer.send({
      type: 'content_delta',
      responseId: 'response-3',
      blockId: 'block-1',
      delta: 'partial',
    })
    writer.send({
      type: 'tool_call_started',
      responseId: 'response-3',
      block: {
        id: 'tool-block-2',
        type: 'tool_call',
        callId: 'call-2',
        toolId: 'shell_exec',
        category: 'shell',
        status: 'running',
        input: { command: 'npm test' },
        createdAt: 2,
      },
    })
    writer.send({
      type: 'tool_call_failed',
      responseId: 'response-3',
      callId: 'call-2',
      error: { code: 'TOOL_CALL_ERROR', message: 'Permission denied' },
      durationMs: 5,
      completedAt: 3,
    })
    writer.send({
      type: 'response_failed',
      responseId: 'response-3',
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'Agent failed' },
      completedAt: 4,
    })

    expect(writer.state()).toEqual({
      responseId: 'response-3',
      text: 'partial',
      usage: undefined,
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'Agent failed' },
      trace: {
        schemaVersion: RESPONSE_SCHEMA_VERSION,
        runtime: 'mastra-chat-agent-v1',
        finishReason: 'error',
        toolCalls: [
          {
            callId: 'call-2',
            toolId: 'shell_exec',
            status: 'error',
            input: { command: 'npm test' },
            outputSummary: 'Permission denied',
            durationMs: 5,
          },
        ],
      },
      toolCalls: [
        {
          callId: 'call-2',
          toolId: 'shell_exec',
          status: 'error',
          input: { command: 'npm test' },
          outputSummary: 'Permission denied',
          durationMs: 5,
        },
      ],
    })
  })

  it('applies tool call delta patches before completion', () => {
    const { writer } = createWriter()

    writer.send({
      type: 'response_started',
      responseId: 'response-4',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      createdAt: 1,
    })
    writer.send({
      type: 'tool_call_started',
      responseId: 'response-4',
      block: {
        id: 'tool-block-3',
        type: 'tool_call',
        callId: 'call-3',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'BloomAI' },
        createdAt: 2,
      },
    })
    writer.send({
      type: 'tool_call_delta',
      responseId: 'response-4',
      callId: 'call-3',
      patch: {
        outputSummary: 'Primary failed, using fallback',
        durationMs: 25,
        statusMessage: 'Switching to fallback search',
      },
    })
    writer.send({
      type: 'tool_call_completed',
      responseId: 'response-4',
      callId: 'call-3',
      completedAt: 3,
    })

    expect(writer.state().toolCalls).toEqual([
      {
        callId: 'call-3',
        toolId: 'web_search',
        status: 'success',
        input: { query: 'BloomAI' },
        outputSummary: 'Primary failed, using fallback',
        durationMs: 25,
      },
    ])
  })

  it('marks running tool calls as failed when the response fails', () => {
    const { writer } = createWriter()

    writer.send({
      type: 'response_started',
      responseId: 'response-5',
      sessionId: 'session-1',
      runtime: 'mastra-chat-agent-v1',
      createdAt: 1,
    })
    writer.send({
      type: 'tool_call_started',
      responseId: 'response-5',
      block: {
        id: 'tool-block-4',
        type: 'tool_call',
        callId: 'call-4',
        toolId: 'web_search',
        category: 'search',
        status: 'running',
        input: { query: 'BloomAI' },
        createdAt: 2,
      },
    })
    writer.send({
      type: 'response_failed',
      responseId: 'response-5',
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'Agent failed' },
      completedAt: 3,
    })

    expect(writer.state()).toMatchObject({
      responseId: 'response-5',
      error: { code: 'AGENT_RUNTIME_ERROR', message: 'Agent failed' },
      trace: {
        finishReason: 'error',
        toolCalls: [
          {
            callId: 'call-4',
            toolId: 'web_search',
            status: 'error',
            input: { query: 'BloomAI' },
            outputSummary: 'Agent failed',
          },
        ],
      },
      toolCalls: [
        {
          callId: 'call-4',
          toolId: 'web_search',
          status: 'error',
          input: { query: 'BloomAI' },
          outputSummary: 'Agent failed',
        },
      ],
    })
  })
})
