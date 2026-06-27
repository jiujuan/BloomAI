import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillCapability } from '../runtime/intent/types'

const runSkillMock = vi.hoisted(() => vi.fn())
const getSkillMock = vi.hoisted(() => vi.fn())

vi.mock('../../skills/run-skill', () => ({
  runSkill: runSkillMock,
}))

vi.mock('../../db/repositories/skill.repo', () => ({
  skillRepo: {
    get: getSkillMock,
  },
}))

import {
  createSkillAdapterTool,
  createSkillAdapterTools,
  createSkillInputSchema,
  fromSkillToolId,
  toSkillToolId,
} from './skill-adapter.tool'

const summarizerSkill: SkillCapability = {
  kind: 'skill',
  id: 'summarizer',
  name: 'Summarizer',
  description: 'Summarize provided text',
  type: 'prompt-template',
  enabled: true,
  paramsSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      maxSentences: { type: 'number' },
    },
    required: ['text'],
  },
}

const disabledSkill: SkillCapability = {
  ...summarizerSkill,
  id: 'disabled-skill',
  enabled: false,
}

describe('Mastra skill adapter tool', () => {
  beforeEach(() => {
    runSkillMock.mockReset()
    getSkillMock.mockReset()
    getSkillMock.mockReturnValue({ id: 'summarizer', is_installed: 1 })
  })

  it('converts skill ids to and from Mastra tool ids', () => {
    expect(toSkillToolId('abc')).toBe('skill:abc')
    expect(fromSkillToolId('skill:abc')).toBe('abc')
    expect(fromSkillToolId('web_search')).toBeNull()
  })

  it('defines a skill tool contract using the skill capability metadata', () => {
    const tool = createSkillAdapterTool(summarizerSkill)

    expect(tool.id).toBe('skill:summarizer')
    expect(tool.description).toContain('Summarize provided text')
    const inputSchema = createSkillInputSchema(summarizerSkill)
    expect(inputSchema.safeParse({ text: 'Long note', maxSentences: 2 }).success).toBe(true)
    expect(inputSchema.safeParse({ maxSentences: 2 }).success).toBe(false)
  })

  it('executes valid input through runSkill with an object output', async () => {
    runSkillMock.mockResolvedValue({ summary: 'Short note' })

    const tool = createSkillAdapterTool(summarizerSkill)
    const result = await tool.execute?.({ text: 'Long note' }, {} as never)

    expect(getSkillMock).toHaveBeenCalledWith('summarizer')
    expect(runSkillMock).toHaveBeenCalledWith('summarizer', { text: 'Long note' })
    expect(result).toEqual({ summary: 'Short note' })
  })

  it('throws when the skill no longer exists or is not installed', async () => {
    getSkillMock.mockReturnValue(undefined)
    const missingTool = createSkillAdapterTool(summarizerSkill)
    await expect(missingTool.execute?.({ text: 'Long note' }, {} as never)).rejects.toThrow('Skill is not installed: summarizer')

    getSkillMock.mockReturnValue({ id: 'summarizer', is_installed: 0 })
    const uninstalledTool = createSkillAdapterTool(summarizerSkill)
    await expect(uninstalledTool.execute?.({ text: 'Long note' }, {} as never)).rejects.toThrow('Skill is not installed: summarizer')
  })

  it('throws for disabled capabilities before checking the repository', async () => {
    const tool = createSkillAdapterTool(disabledSkill)

    await expect(tool.execute?.({ text: 'Long note' }, {} as never)).rejects.toThrow('Skill capability is disabled: disabled-skill')
    expect(getSkillMock).not.toHaveBeenCalled()
    expect(runSkillMock).not.toHaveBeenCalled()
  })

  it('does not call runSkill when input schema validation fails', async () => {
    const tool = createSkillAdapterTool(summarizerSkill)

    expect(createSkillInputSchema(summarizerSkill).safeParse({ text: 123 }).success).toBe(false)
    await expect(tool.execute?.({ text: 123 }, {} as never)).resolves.toEqual(expect.objectContaining({ error: true }))
    expect(runSkillMock).not.toHaveBeenCalled()
  })

  it('creates tools only for enabled selected skills', () => {
    const tools = createSkillAdapterTools([summarizerSkill, disabledSkill])

    expect(Object.keys(tools)).toEqual(['skill:summarizer'])
  })
})