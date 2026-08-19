import { describe, expect, it } from 'vitest'
import {
  appendErrorAssistantMessage,
  buildErrorAssistantMessage,
  chatAgentHeaderForTab,
  isChatComposerVisible,
  isDeepResearchWorkbenchActive,
  restoreParts,
  shouldQueueMessageUntilSessionIsActive,
  truncateChatHeaderTitle,
} from './ChatPanelMastra'

describe('initial chat session activation', () => {
  it('queues the first message until the created session becomes active', () => {
    expect(shouldQueueMessageUntilSessionIsActive(null, 'session-1')).toBe(true)
    expect(shouldQueueMessageUntilSessionIsActive('session-1', 'session-1')).toBe(false)
  })
})


describe('chat header title', () => {
  it('keeps titles at or below the display limit unchanged', () => {
    expect(truncateChatHeaderTitle('12345678901234567890')).toBe('12345678901234567890')
  })

  it('truncates titles over the display limit and appends an ellipsis', () => {
    expect(truncateChatHeaderTitle('123456789012345678901')).toBe('12345678901234567890...')
  })

  it('counts unicode characters rather than UTF-16 code units', () => {
    expect(truncateChatHeaderTitle('😀'.repeat(21))).toBe(`${'😀'.repeat(20)}...`)
  })
})
describe('Deep Research workbench routing', () => {
  it('always renders the research tab as the durable workbench', () => {
    expect(isDeepResearchWorkbenchActive('research')).toBe(true)
    expect(isChatComposerVisible('research')).toBe(false)
    expect(chatAgentHeaderForTab('research')).toBe('')
  })
})

describe('chat error timeline', () => {
  it('builds a durable error assistant message from the friendly error text', () => {
    expect(buildErrorAssistantMessage(new Error('模型配置错误'), 'error-1')).toEqual({
      id: 'error-1',
      role: 'assistant',
      content: '',
      parts: [{ type: 'data-error', data: { title: '请求失败', message: '模型配置错误' } }],
    })
  })

  it('sanitizes raw transport errors and appends them without replacing history', () => {
    const history = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '第一个问题' }] },
      { id: 'error-1', role: 'assistant', parts: [{ type: 'data-error', data: { title: '请求失败', message: '模型配置错误' } }] },
    ]
    const next = appendErrorAssistantMessage(history, new Error('Error: provider secret\n    at provider'), 'error-2')

    expect(next.slice(0, history.length)).toEqual(history)
    expect(next.at(-1)).toEqual({
      id: 'error-2',
      role: 'assistant',
      content: '',
      parts: [{ type: 'data-error', data: { title: '请求失败', message: '请求出错了，请稍后重试。' } }],
    })
  })

  it('removes only the transient empty assistant placeholder before adding the error', () => {
    const history = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '问题' }] },
      { id: 'streaming-1', role: 'assistant', parts: [{ type: 'step-start' }] },
    ]
    const next = appendErrorAssistantMessage(history, new Error('大模型调用失败'), 'error-4')

    expect(next).toHaveLength(2)
    expect(next[0]).toEqual(history[0])
    expect(next[1].parts).toEqual([{ type: 'data-error', data: { title: '请求失败', message: '大模型调用失败' } }])
  })

  it('restores a persisted error part as a chat message part', () => {
    const saved = buildErrorAssistantMessage(new Error('大模型调用失败'), 'error-3')

    expect(restoreParts({ content: saved.content, parts: JSON.stringify(saved.parts) })).toEqual(saved.parts)
  })
})
