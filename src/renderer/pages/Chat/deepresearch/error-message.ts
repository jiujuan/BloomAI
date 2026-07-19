type ErrorLike = { code?: unknown; message?: unknown }

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as ErrorLike).code
  return typeof code === 'string' ? code : null
}

function originalMessage(error: unknown): string | null {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error !== 'object' || error === null) return null
  const message = (error as ErrorLike).message
  return typeof message === 'string' ? message : null
}

/** Converts safe Deep Research error codes into short, actionable Chinese UI text. */
export function deepResearchErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'RESEARCH_MODEL_UNAVAILABLE':
      return '未配置可用的深度研究模型。请在“设置 → 模型”中配置并启用文本模型，然后选择“深度研究模型”后重试。'
    case 'RESEARCH_BUDGET_EXHAUSTED':
      return '研究已达到搜索或资源预算上限，已停止继续检索。请缩小研究范围或选择更高的研究深度后重试。'
    case 'RESEARCH_PROVIDER_TIMEOUT':
    case 'RESEARCH_MODEL_TIMEOUT':
      return '深度研究模型响应超时。可点击重试；如果持续超时，请切换响应更快的模型或检查模型服务状态。'
    case 'RESEARCH_MODEL_OUTPUT_LIMIT':
      return '深度研究模型输出达到长度上限，但没有返回完整的 JSON 结果。可点击重试；如果持续失败，请缩小研究主题或切换更适合结构化输出的模型。'
    case 'RESEARCH_MODEL_INVALID_OUTPUT':
      return '深度研究模型返回了无法解析的结构化结果。请检查模型是否支持 JSON/结构化输出后重试。'
    default:
      return originalMessage(error) ?? '深度研究请求失败'
  }
}
