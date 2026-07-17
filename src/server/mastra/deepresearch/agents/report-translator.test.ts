import { describe, expect, it } from 'vitest'
import { isPredominantlyEnglish } from './report-translator'

describe('report translation language detection', () => {
  it('requests a Chinese counterpart only for English report Markdown', () => {
    expect(isPredominantlyEnglish('# Brief report\n\nThe evidence is limited.')).toBe(true)
    expect(isPredominantlyEnglish('# Market report\n\nThe evidence supports a cautious finding with limitations. '.repeat(4))).toBe(true)
    expect(isPredominantlyEnglish('# \u4e2d\u6587\u62a5\u544a\n\n\u8bc1\u636e\u652f\u6301\u4e00\u4e2a\u8c28\u614e\u7684\u7ed3\u8bba\u3002'.repeat(8))).toBe(false)
  })
})
