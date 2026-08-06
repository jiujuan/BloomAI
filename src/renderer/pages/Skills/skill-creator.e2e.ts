import { describe, expect, it } from 'vitest'
import { sanitizeMarkdown } from './SkillCreatorPreview'

describe('Skills Creator browser contract', () => {
  it('does not execute HTML while rendering a draft preview', () => {
    expect(sanitizeMarkdown('<img src=x onerror=alert(1)># safe')).not.toContain('onerror')
    expect(sanitizeMarkdown('<script>window.secret = 1</script>')).not.toContain('<script>')
  })
})
