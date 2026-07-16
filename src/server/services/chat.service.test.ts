import { describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_TOTAL_BUDGET, createChatService, normalizeChatInput } from './chat.service'

describe('Chat Service input normalization', () => {
  it('uses HTTP header values and normalizes plan, writer and attachment inputs', () => {
    const normalized = normalizeChatInput({
      body: {
        sessionId: ' body-session ',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Write a post' }] }],
        plan: [' Draft outline ', 'Draft outline', '', 'Publish'],
        writing: { type: 'xiaohongshu', params: { words: '500', untrusted: 'drop-me' } },
        attachments: [
          { name: 'brief.txt', ext: 'txt', path: 'C:/safe/brief.txt', size: 20 },
          { name: 'broken.pdf', ext: 'pdf' },
        ],
      },
      headers: { mode: 'deep', model: 'custom-model', sessionId: ' header-session ', agentTab: 'writing' },
    })

    expect(normalized).toMatchObject({
      sessionId: 'header-session',
      mode: 'deep',
      model: 'custom-model',
      teamAgentId: 'writer',
      planTasks: ['Draft outline', 'Publish'],
      writing: { type: 'xiaohongshu', params: { words: '500' } },
    })
    expect(normalized.attachments).toEqual([
      { name: 'brief.txt', ext: 'txt', path: 'C:/safe/brief.txt', size: 20 },
    ])
  })

  it('falls back to body session and default mode/model without accepting invalid values', () => {
    const normalized = normalizeChatInput({
      body: { id: ' body-id ', messages: 'not-an-array', plan: ['task', 'task', 1] },
      headers: { mode: '', model: '', sessionId: '', agentTab: 'unknown' },
    })

    expect(normalized.sessionId).toBe('body-id')
    expect(normalized.mode).toBe('chat')
    expect(normalized.model).toBe('agnes-2.0-flash')
    expect(normalized.teamAgentId).toBeUndefined()
    expect(normalized.messages).toEqual([])
    expect(normalized.planTasks).toEqual(['task'])
  })
})

describe('Chat Service message persistence and attachments', () => {
  it('persists the user message, client-safe attachment data, session touch and first title', () => {
    const messageRepo = { count: vi.fn(() => 0), save: vi.fn() }
    const sessionRepo = { touch: vi.fn(), update: vi.fn() }
    const service = createChatService({ messageRepo, sessionRepo, logError: vi.fn() })

    service.persistUserMessage('session-1', [
      { role: 'user', parts: [{ type: 'text', text: 'Summarize this brief' }] },
    ], [{ id: 'attachment-1', name: 'brief.txt', ext: 'txt', path: 'C:/private/brief.txt', size: 20, uploadedAt: 1 }])

    expect(messageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session-1',
      role: 'user',
      content: 'Summarize this brief',
    }))
    const savedParts = JSON.parse(messageRepo.save.mock.calls[0][0].parts)
    expect(savedParts).toEqual([
      { type: 'text', text: 'Summarize this brief' },
      { type: 'data-attachments', data: { files: [{ id: 'attachment-1', name: 'brief.txt', ext: 'txt', size: 20, uploadedAt: 1 }] } },
    ])
    expect(sessionRepo.touch).toHaveBeenCalledWith('session-1')
    expect(sessionRepo.update).toHaveBeenCalledWith('session-1', { title: 'Summarize this brief' })
  })

  it('does not let user persistence errors stop the request path', () => {
    const logError = vi.fn()
    const service = createChatService({
      messageRepo: { count: vi.fn(() => { throw new Error('database unavailable') }), save: vi.fn() },
      sessionRepo: { touch: vi.fn(), update: vi.fn() },
      logError,
    })

    expect(() => service.persistUserMessage('session-1', [{ role: 'user', content: 'Hello' }])).not.toThrow()
    expect(logError).toHaveBeenCalledWith('chat.persistUser', expect.objectContaining({ code: 'PERSISTENCE_ERROR' }), { sessionId: 'session-1' })
  })

  it('keeps attachment extraction failures visible in the prompt block and enforces the total budget', async () => {
    const service = createChatService({
      extractAttachmentText: vi.fn()
        .mockRejectedValueOnce(new Error('bad PDF'))
        .mockResolvedValueOnce('x'.repeat(ATTACHMENT_TOTAL_BUDGET + 100)),
    })

    const block = await service.buildAttachmentBlock([
      { id: 'a', name: 'bad.pdf', ext: 'pdf', path: 'C:/private/bad.pdf', size: 1, uploadedAt: 1 },
      { id: 'b', name: 'large.txt', ext: 'txt', path: 'C:/private/large.txt', size: 1, uploadedAt: 1 },
    ])

    expect(block).toContain('bad.pdf')
    expect(block).toContain('文本提取失败')
    expect(block.length).toBeLessThan(ATTACHMENT_TOTAL_BUDGET + 1000)
  })

  it('preserves assistant persistence success, empty and failure outcomes', () => {
    const messageRepo = { count: vi.fn(), save: vi.fn() }
    const sessionRepo = { touch: vi.fn(), update: vi.fn() }
    const service = createChatService({ messageRepo, sessionRepo, logError: vi.fn() })

    expect(service.persistAssistantMessage({ sessionId: '' }).kind).toBe('session-required')
    expect(service.persistAssistantMessage({ sessionId: 's', content: '', parts: null }).kind).toBe('empty')
    expect(service.persistAssistantMessage({
      sessionId: 's', content: 'Answer', parts: [{ type: 'text', text: 'Answer' },], model: 'agnes', usage: { inputTokens: 2, outputTokens: 3 },
    })).toEqual({ kind: 'saved' })
    expect(messageRepo.save).toHaveBeenCalledWith(expect.objectContaining({ tokens: 5, parts: JSON.stringify([{ type: 'text', text: 'Answer' }]) }))
    expect(sessionRepo.touch).toHaveBeenCalledWith('s')

    const failing = createChatService({
      messageRepo: { count: vi.fn(), save: vi.fn(() => { throw new Error('write failed') }) },
      sessionRepo, logError: vi.fn(),
    })
    expect(failing.persistAssistantMessage({ sessionId: 's', content: 'Answer' })).toEqual({ kind: 'failed' })
  })
})


describe('Chat Service plan proposal', () => {
  it('builds a scoped planner request, preserves planner memory and normalizes tolerant JSON output', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'Here is the plan:\n```json\n[" Inspect input ", "Inspect input", "Generate output"]\n```' })
    const requestContext = { set: vi.fn() }
    const service = createChatService({
      mastra: { getAgent: vi.fn(() => ({ generate })) } as any,
      createRequestContext: () => requestContext as any,
      logError: vi.fn(),
    })

    await expect(service.proposePlan({
      sessionId: 'plan-1', model: 'planner-model', query: 'Build a launch plan', avoid: ['Old task'],
    })).resolves.toEqual({ tasks: ['Inspect input', 'Generate output'] })
    expect(requestContext.set).toHaveBeenNthCalledWith(1, 'model', 'planner-model')
    expect(requestContext.set).toHaveBeenNthCalledWith(2, 'sessionId', 'plan-1')
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('avoid repeating these tasks'),
      expect.objectContaining({ memory: { thread: 'plan-1', resource: 'bloomai-local-user' } }),
    )
  })

  it('returns no tasks for an empty request and a query fallback for provider failures', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const logError = vi.fn()
    const service = createChatService({
      mastra: { getAgent: vi.fn(() => ({ generate })) } as any,
      createRequestContext: () => ({ set: vi.fn() }) as any,
      logError,
    })

    await expect(service.proposePlan({ sessionId: 's', model: 'm', query: '   ' })).resolves.toEqual({ tasks: [] })
    expect(generate).not.toHaveBeenCalled()
    await expect(service.proposePlan({ sessionId: 's', model: 'm', query: 'Plan a trip' })).resolves.toEqual({ tasks: ['Plan a trip'] })
    expect(logError).toHaveBeenCalledWith('chat.proposePlan', expect.objectContaining({ code: 'PLAN_ERROR' }), { sessionId: 's' })
  })
})

describe('Chat Service stream orchestration', () => {
  it('persists before calling the general agent and maps request context, memory and abort signal', async () => {
    const requestContext = { set: vi.fn() }
    const stream = new ReadableStream({ start: (controller) => controller.close() })
    const messageRepo = { count: vi.fn(() => 1), save: vi.fn() }
    const handleChatStream = vi.fn().mockResolvedValue(stream)
    const service = createChatService({
      messageRepo,
      sessionRepo: { touch: vi.fn(), update: vi.fn() },
      handleChatStream: handleChatStream as any,
      createRequestContext: () => requestContext as any,
      logError: vi.fn(),
    })
    const abort = new AbortController()
    const input = normalizeChatInput({
      body: { messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }] },
      headers: { sessionId: 'session-1', mode: 'chat', model: 'agnes' },
    })

    await expect(service.streamChat(input, abort.signal)).resolves.toBe(stream)
    expect(messageRepo.save.mock.invocationCallOrder[0]).toBeLessThan(handleChatStream.mock.invocationCallOrder[0])
    expect(requestContext.set).toHaveBeenNthCalledWith(1, 'mode', 'chat')
    expect(requestContext.set).toHaveBeenNthCalledWith(2, 'model', 'agnes')
    expect(requestContext.set).toHaveBeenNthCalledWith(3, 'sessionId', 'session-1')
    expect(handleChatStream).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'chat',
      params: expect.objectContaining({
        memory: { threadId: 'session-1', resourceId: 'bloomai-local-user' },
        abortSignal: abort.signal,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      }),
    }))
  })

  it('gives a selected team agent precedence over deep mode and does not add Memory', async () => {
    const handleChatStream = vi.fn().mockResolvedValue(new ReadableStream({ start: (controller) => controller.close() }))
    const getWorkflow = vi.fn()
    const service = createChatService({
      handleChatStream: handleChatStream as any,
      mastra: { getWorkflow } as any,
      createRequestContext: () => ({ set: vi.fn() }) as any,
      messageRepo: { count: vi.fn(() => 1), save: vi.fn() },
      sessionRepo: { touch: vi.fn(), update: vi.fn() },
      logError: vi.fn(),
    })
    const input = normalizeChatInput({
      body: { messages: [{ role: 'user', content: 'Research this' }, { role: 'assistant', content: 'Prior answer' }] },
      headers: { sessionId: 's', mode: 'deep', agentTab: 'writing' },
    })

    await service.streamChat(input)
    expect(getWorkflow).not.toHaveBeenCalled()
    expect(handleChatStream).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'writer',
      params: expect.objectContaining({ messages: input.messages }),
    }))
    expect(handleChatStream.mock.calls[0][0].params.memory).toBeUndefined()
  })

  it('routes a deep request without a team agent through the workflow stream', async () => {
    const workflowStream = { [Symbol.asyncIterator]: async function* () { yield { type: 'start' } } }
    const stream = new ReadableStream({ start: (controller) => controller.close() })
    const run = { stream: vi.fn().mockResolvedValue(workflowStream) }
    const createRun = vi.fn().mockResolvedValue(run)
    const getWorkflow = vi.fn(() => ({ createRun }))
    const toAISdkStream = vi.fn(() => workflowStream)
    let execute: ((input: any) => Promise<void>) | undefined
    const createUIMessageStream = vi.fn((options: any) => { execute = options.execute; return stream })
    const handleChatStream = vi.fn()
    const service = createChatService({
      mastra: { getWorkflow } as any,
      toAISdkStream: toAISdkStream as any,
      createUIMessageStream: createUIMessageStream as any,
      handleChatStream: handleChatStream as any,
      createRequestContext: () => ({ set: vi.fn() }) as any,
      messageRepo: { count: vi.fn(() => 1), save: vi.fn() },
      sessionRepo: { touch: vi.fn(), update: vi.fn() },
      logError: vi.fn(),
    })
    const input = normalizeChatInput({
      body: { messages: [{ role: 'user', content: 'Deep question' }] },
      headers: { sessionId: 's', mode: 'deep' },
    })

    await expect(service.streamChat(input)).resolves.toBe(stream)
    expect(createRun).toHaveBeenCalledOnce()
    expect(run.stream).toHaveBeenCalledWith(expect.objectContaining({ inputData: { query: 'Deep question' } }))
    await execute!({ writer: { write: vi.fn() } })
    expect(toAISdkStream).toHaveBeenCalledWith(workflowStream, { from: 'workflow' })
    expect(handleChatStream).not.toHaveBeenCalled()
  })

  it('injects the confirmed plan after start and at stream end when no start arrives', async () => {
    const executeCallbacks: Array<(input: any) => Promise<void>> = []
    const createUIMessageStream = vi.fn((options: any) => {
      executeCallbacks.push(options.execute)
      return { tag: `stream-${executeCallbacks.length}` } as any
    })
    const handleChatStream = vi.fn()
      .mockResolvedValueOnce({ [Symbol.asyncIterator]: async function* () { yield { type: 'start' }; yield { type: 'text-delta', delta: 'A' } } })
      .mockResolvedValueOnce({ [Symbol.asyncIterator]: async function* () { yield { type: 'text-delta', delta: 'B' } } })
    const service = createChatService({
      createUIMessageStream: createUIMessageStream as any,
      handleChatStream: handleChatStream as any,
      createRequestContext: () => ({ set: vi.fn() }) as any,
      messageRepo: { count: vi.fn(() => 1), save: vi.fn() },
      sessionRepo: { touch: vi.fn(), update: vi.fn() },
      logError: vi.fn(),
    })
    const input = normalizeChatInput({
      body: { messages: [{ role: 'user', content: 'Execute' }], plan: ['One task'] },
      headers: { sessionId: 's' },
    })

    await service.streamChat(input)
    const firstWrites: any[] = []
    await executeCallbacks[0]({ writer: { write: async (part: any) => { firstWrites.push(part) } } })
    expect(firstWrites).toEqual([
      { type: 'start' },
      { type: 'data-plan', data: { tasks: ['One task'] } },
      { type: 'text-delta', delta: 'A' },
    ])

    await service.streamChat(input)
    const lastWrites: any[] = []
    await executeCallbacks[1]({ writer: { write: async (part: any) => { lastWrites.push(part) } } })
    expect(lastWrites).toEqual([
      { type: 'text-delta', delta: 'B' },
      { type: 'data-plan', data: { tasks: ['One task'] } },
    ])
  })
})


  it('caps a valid planner task list at the documented maximum', async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => `Task ${index + 1}`)
    const service = createChatService({
      mastra: { getAgent: vi.fn(() => ({ generate: vi.fn().mockResolvedValue({ text: JSON.stringify(tasks) }) })) } as any,
      createRequestContext: () => ({ set: vi.fn() }) as any,
      logError: vi.fn(),
    })

    const result = await service.proposePlan({ sessionId: 's', model: 'm', query: 'Do it' })
    expect(result.tasks).toEqual(tasks.slice(0, 10))
  })
