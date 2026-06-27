import { beforeEach, describe, expect, it, vi } from 'vitest'

const listInstalledMock = vi.hoisted(() => vi.fn())

vi.mock('../../db/repositories/skill.repo', () => ({
  skillRepo: {
    listInstalled: listInstalledMock,
  },
}))

describe('chat runtime capability discovery', () => {
  beforeEach(() => {
    listInstalledMock.mockReset()
  })

  it('discovers the built-in web_search tool capability', async () => {
    const { listChatToolCapabilities } = await import('./capabilities')

    expect(listChatToolCapabilities()).toEqual([
      expect.objectContaining({
        kind: 'tool',
        id: 'web_search',
        enabled: true,
        name: 'Web search',
      }),
    ])
  })

  it('converts installed skills with valid params_schema into enabled capabilities', async () => {
    listInstalledMock.mockReturnValue([
      {
        id: 'skill-1',
        name: 'Summarizer',
        description: 'Summarize selected text',
        type: 'prompt-template',
        source: 'Summarize {{text}}',
        params_schema: '{"type":"object","properties":{"text":{"type":"string"}}}',
        author: 'custom',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: 1,
      },
    ])
    const { resolveChatCapabilities } = await import('./capabilities')

    expect(resolveChatCapabilities()).toEqual({
      tools: [expect.objectContaining({ id: 'web_search', enabled: true })],
      skills: [
        expect.objectContaining({
          kind: 'skill',
          id: 'skill-1',
          name: 'Summarizer',
          enabled: true,
          paramsSchema: { type: 'object', properties: { text: { type: 'string' } } },
        }),
      ],
    })
  })

  it('does not expose installed skills with invalid params_schema as enabled capabilities', async () => {
    listInstalledMock.mockReturnValue([
      {
        id: 'skill-bad',
        name: 'Broken Skill',
        description: 'Invalid schema',
        type: 'js-function',
        source: 'return input',
        params_schema: '{not-json',
        author: 'custom',
        version: '1.0.0',
        is_public: 0,
        is_installed: 1,
        install_count: 0,
        created_at: 1,
      },
    ])
    const { listChatSkillCapabilities } = await import('./capabilities')

    expect(listChatSkillCapabilities()).toEqual([
      expect.objectContaining({
        id: 'skill-bad',
        enabled: false,
        disabledReason: expect.stringContaining('Invalid params_schema'),
      }),
    ])
  })
})
