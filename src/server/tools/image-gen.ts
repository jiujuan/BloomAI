import { generateImage } from '../llm'
import type { ToolExecutor } from './types'

export const imageGenTool: ToolExecutor<{ prompt: string; model?: string; size?: string; quality?: string; image?: string | string[]; responseFormat?: 'url' | 'b64_json'; saveTo?: string }> = async (input) => {
  return generateImage({
    model: input.model || 'dall-e-3',
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    image: input.image,
    responseFormat: input.responseFormat,
    saveTo: input.saveTo,
  })
}
