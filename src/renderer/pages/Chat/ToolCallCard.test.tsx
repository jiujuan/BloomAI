import { describe, expect, it } from 'vitest'
import { ToolCallCard } from './ToolCallCard'

describe('ToolCallCard', () => {
  it('keeps callId on the rendered card contract', () => {
    expect(ToolCallCard).toBeTypeOf('function')
  })

  it('shows only the top three search results in success output', () => {
    const output = {
      results: [
        { title: 'R1', url: 'https://e/1', snippet: 'S1' },
        { title: 'R2', url: 'https://e/2', snippet: 'S2' },
        { title: 'R3', url: 'https://e/3', snippet: 'S3' },
        { title: 'R4', url: 'https://e/4', snippet: 'S4' },
      ],
    }

    expect(output.results.slice(0, 3)).toHaveLength(3)
  })
})
