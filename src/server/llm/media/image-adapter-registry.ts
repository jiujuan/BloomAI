import type { ImageGenerationResult, ResolvedImageGenerationRequest } from '../types'

export interface ImageProviderAdapter {
  generate(input: ResolvedImageGenerationRequest): Promise<ImageGenerationResult>
}

const registry = new Map<string, ImageProviderAdapter>()

export function registerImageAdapter(providerId: string, adapter: ImageProviderAdapter): void {
  registry.set(providerId, adapter)
}

export function getImageAdapter(providerId: string): ImageProviderAdapter | undefined {
  return registry.get(providerId)
}
