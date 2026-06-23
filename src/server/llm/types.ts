export type LlmProviderId =
  | 'anthropic'
  | 'openai'
  | 'agnes'
  | 'deepseek'
  | 'ollama'
  | string

export type LlmModality = 'text' | 'image' | 'video'

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatStreamRequest = {
  model: string
  system?: string
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' }

export type LlmProviderConfig = {
  id: LlmProviderId
  name: string
  kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  baseUrl: string | null
  apiKeySettingKey: string | null
  isEnabled: boolean
  config: Record<string, unknown>
}

export type LlmModelConfig = {
  id: string
  providerId: string
  modelId: string
  label: string
  modality: LlmModality
  capabilities: Record<string, unknown>
  isEnabled: boolean
  isBuiltin: boolean
  sortOrder: number
}

export type ResolvedLlmModel = {
  provider: LlmProviderConfig
  model: LlmModelConfig
}

export interface ChatProvider {
  streamChat(input: ChatStreamRequest): AsyncGenerator<ChatStreamEvent>
}

export type ImageGenerationRequest = {
  model: string
  prompt: string
  size?: string
  quality?: string
  image?: string | string[]
  responseFormat?: 'url' | 'b64_json'
  saveTo?: string
}

export type ResolvedImageGenerationRequest = ImageGenerationRequest & {
  resolved: ResolvedLlmModel
}

export type ImageGenerationResult = {
  providerId: string
  model: string
  url?: string
  b64_json?: string
  localPath?: string
}

export type VideoGenerationRequest = {
  model: string
  prompt: string
  image?: string | string[]
  width?: number
  height?: number
  numFrames?: number
  frameRate?: number
  seed?: number
  negativePrompt?: string
}

export type ResolvedVideoGenerationRequest = VideoGenerationRequest & {
  resolved: ResolvedLlmModel
}

export type VideoTaskResult = {
  taskId: string
  videoId?: string
  providerId: string
  model: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress?: number
  url?: string
  error?: string
}

export type OpenAIStreamParseResult =
  | { type: 'delta'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' }
  | { type: 'ignore' }

export type OllamaStreamParseResult =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'ignore' }
