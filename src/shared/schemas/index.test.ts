import { describe, expect, it } from 'vitest'
import { CreateProjectInputSchema, ProjectDirectoryKindSchema, SessionPageSchema } from './index'

describe('project chat shared schemas', () => {
  it('trims valid project names and rejects blank or too-long names', () => {
    expect(CreateProjectInputSchema.parse({ name: '  Alpha  ' })).toEqual({ name: 'Alpha' })
    expect(() => CreateProjectInputSchema.parse({ name: '   ' })).toThrow()
    expect(() => CreateProjectInputSchema.parse({ name: 'a'.repeat(81) })).toThrow()
  })

  it('accepts only known directory kinds', () => {
    expect(ProjectDirectoryKindSchema.parse('auto')).toBe('auto')
    expect(ProjectDirectoryKindSchema.parse('selected')).toBe('selected')
    expect(() => ProjectDirectoryKindSchema.parse('other')).toThrow()
  })

  it('validates recent/project session pagination metadata', () => {
    expect(SessionPageSchema.parse({
      data: [],
      meta: { total: 0, limit: 15, offset: 0 },
    })).toEqual({ data: [], meta: { total: 0, limit: 15, offset: 0 } })
    expect(() => SessionPageSchema.parse({ data: [], meta: { total: -1, limit: 0, offset: -1 } })).toThrow()
  })
})
