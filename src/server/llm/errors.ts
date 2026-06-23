export type LlmErrorCode =
  | 'LLM_CONFIG_ERROR'
  | 'LLM_PROVIDER_ERROR'
  | 'LLM_RESPONSE_PARSE_ERROR'
  | 'LLM_UNSUPPORTED_MODEL'

export class LlmError extends Error {
  readonly code: LlmErrorCode

  constructor(code: LlmErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export class LlmConfigError extends LlmError {
  constructor(message: string, options?: ErrorOptions) {
    super('LLM_CONFIG_ERROR', message, options)
  }
}

export class LlmProviderError extends LlmError {
  constructor(message: string, options?: ErrorOptions) {
    super('LLM_PROVIDER_ERROR', message, options)
  }
}

export class LlmResponseParseError extends LlmError {
  constructor(message: string, options?: ErrorOptions) {
    super('LLM_RESPONSE_PARSE_ERROR', message, options)
  }
}

export class LlmUnsupportedModelError extends LlmError {
  constructor(message: string, options?: ErrorOptions) {
    super('LLM_UNSUPPORTED_MODEL', message, options)
  }
}
