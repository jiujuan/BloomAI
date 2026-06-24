import { describe, expect, it } from 'vitest'
import { shouldShowStreamingBubble } from './Timeline'

describe('Timeline', () => {
  it('shows streaming bubble when text exists', () => {
    expect(shouldShowStreamingBubble(false, 'hello')).toBe(true)
  })

  it('hides streaming bubble when idle', () => {
    expect(shouldShowStreamingBubble(false, '')).toBe(false)
  })
})
