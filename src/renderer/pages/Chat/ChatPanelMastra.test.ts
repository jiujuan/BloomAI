import { describe, expect, it } from 'vitest'
import {
  chatAgentHeaderForTab,
  isChatComposerVisible,
  isDeepResearchWorkbenchActive,
  shouldQueueMessageUntilSessionIsActive,
} from './ChatPanelMastra'

describe('initial chat session activation', () => {
  it('queues the first message until the created session becomes active', () => {
    expect(shouldQueueMessageUntilSessionIsActive(null, 'session-1')).toBe(true)
    expect(shouldQueueMessageUntilSessionIsActive('session-1', 'session-1')).toBe(false)
  })
})


describe('Deep Research workbench routing', () => {
  it('always renders the research tab as the durable workbench', () => {
    expect(isDeepResearchWorkbenchActive('research')).toBe(true)
    expect(isChatComposerVisible('research')).toBe(false)
    expect(chatAgentHeaderForTab('research')).toBe('')
  })
})
