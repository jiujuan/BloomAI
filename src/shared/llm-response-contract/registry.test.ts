import { describe, expect, it } from 'vitest'
import {
  getResponseEventDefinition,
  RESPONSE_EVENT_REGISTRY,
  RESPONSE_EVENT_TYPES,
} from './event-registry'
import {
  getTimelineStateDefinition,
  TIMELINE_STATE_REGISTRY,
} from './timeline-state-registry'
import {
  ERROR_TIMELINE_REGISTRY,
  resolveErrorTimeline,
} from './error-timeline-registry'

describe('LLM response contract registries', () => {
  it('covers every v1 response stream event type', () => {
    expect(RESPONSE_EVENT_TYPES).toEqual([
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
    ])
    expect(Object.keys(RESPONSE_EVENT_REGISTRY)).toEqual(RESPONSE_EVENT_TYPES)
  })

  it('describes response failure as a visible timeline error', () => {
    const definition = getResponseEventDefinition('response_failed')

    expect(definition.timelineDescription).toContain('错误')
    expect(definition.failureSemantics).toContain('不得再发送')
  })

  it('keeps timeline display states queryable by stable keys', () => {
    expect(Object.keys(TIMELINE_STATE_REGISTRY)).toContain('tool_soft_failed')

    const definition = getTimelineStateDefinition('tool_soft_failed')

    expect(definition.assistantBubble).toBe('preserve_or_stream')
    expect(definition.toolGroupStatus).toBe('partial_error')
    expect(definition.visibleError).toBe(true)
  })

  it('maps known and unknown error codes to timeline behavior', () => {
    expect(ERROR_TIMELINE_REGISTRY.TOOL_CALL_ERROR.canContinue).toBe('depends')
    expect(resolveErrorTimeline({ code: 'TOOL_CALL_ERROR', message: 'Search failed' }))
      .toMatchObject({
        timelineMessage: '工具执行失败',
        groupBehavior: 'mark_related_group_failed',
      })
    expect(resolveErrorTimeline({ code: 'NOT_A_KNOWN_CODE', message: 'Unexpected' }))
      .toBe(ERROR_TIMELINE_REGISTRY.UNKNOWN_ERROR)
  })
})
