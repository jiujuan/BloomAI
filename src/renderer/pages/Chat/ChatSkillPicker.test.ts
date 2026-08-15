import { describe, expect, it } from 'vitest'
import type { ChatSkillReferenceDto } from '@renderer/api'
import { filterChatSkills, paginateChatSkills, skillDisplayName } from './ChatSkillPicker'

function skill(index: number, overrides: Partial<ChatSkillReferenceDto> = {}): ChatSkillReferenceDto {
  return {
    packageId: `package-${index}`,
    packageName: `skill-${index}`,
    description: `Description for skill ${index}`,
    skillVersionId: `version-${index}`,
    version: '1.0.0',
    requiredCapabilities: [],
    ...overrides,
  }
}

describe('ChatSkillPicker helpers', () => {
  it('shows skill names without a trailing version suffix', () => {
    expect(skillDisplayName('skill-creator · v1.2.3')).toBe('skill-creator')
    expect(skillDisplayName('skill-creator')).toBe('skill-creator')
  })

  it('filters skills by name or description without case sensitivity', () => {
    const skills = [
      skill(1, { packageName: 'skill-creator', description: 'Create reusable skills.' }),
      skill(2, { packageName: 'browser-control', description: 'Operate the in-app browser.' }),
    ]

    expect(filterChatSkills(skills, 'CREATOR')).toEqual([skills[0]])
    expect(filterChatSkills(skills, 'browser')).toEqual([skills[1]])
    expect(filterChatSkills(skills, 'missing')).toEqual([])
  })

  it('returns 20 skills per page and keeps the remainder on the next page', () => {
    const skills = Array.from({ length: 21 }, (_, index) => skill(index + 1))

    expect(paginateChatSkills(skills, 1, 20)).toHaveLength(20)
    expect(paginateChatSkills(skills, 2, 20)).toEqual([skills[20]])
  })
})