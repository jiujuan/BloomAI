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

  it('renders actionable invalid structured output guidance', () => {
    expect(deepResearchErrorMessage({ code: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED', message: 'raw schema validation' })).toContain('无法解析的结构化结果')
  })

  it('renders actionable output-limit guidance', () => {
    expect(deepResearchErrorMessage({ code: 'RESEARCH_MODEL_OUTPUT_LIMIT', message: 'raw output limit' })).toContain('输出达到长度上限')
    expect(deepResearchErrorMessage({ code: 'RESEARCH_MODEL_OUTPUT_LIMIT', message: 'raw output limit' })).toContain('缩小研究主题')
  })

})
