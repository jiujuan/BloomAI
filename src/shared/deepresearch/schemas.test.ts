import { describe, expect, it } from 'vitest'
import { clarificationSchema, startResearchSchema } from './schemas'

describe('deep research schemas', () => {
  it('normalizes a valid research start request', () => {
    const result = startResearchSchema.parse({
      topic: '  Enterprise AI assistant market  ',
      profile: 'market',
      depth: 'deep',
      geography: [' United States '],
    })

    expect(result).toMatchObject({
      topic: 'Enterprise AI assistant market',
      profile: 'market',
      depth: 'deep',
      geography: ['United States'],
    })
  })

  it('rejects invalid research input and empty clarification answers', () => {
    expect(startResearchSchema.safeParse({ topic: 'x', profile: 'invalid', depth: 'deep' }).success).toBe(false)
    expect(clarificationSchema.safeParse({ clarificationId: 'clarification-1', answer: '   ' }).success).toBe(false)
  })
})
