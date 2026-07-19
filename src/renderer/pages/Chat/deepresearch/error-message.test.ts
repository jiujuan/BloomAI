import { describe, expect, it } from 'vitest'
import { deepResearchErrorMessage } from './error-message'

describe('deepResearchErrorMessage', () => {
  it.each(['RESEARCH_PROVIDER_TIMEOUT', 'RESEARCH_MODEL_TIMEOUT'])(
    'renders actionable timeout guidance for %s',
    (code) => {
      expect(deepResearchErrorMessage({ code, message: 'raw provider timeout' })).toContain('模型响应超时')
      expect(deepResearchErrorMessage({ code, message: 'raw provider timeout' })).toContain('切换响应更快的模型')
    },
  )
})
