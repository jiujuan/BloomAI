export type ToolAvailability =
  | { status: 'available' }
  | { status: 'disabled'; reason: string }
  | { status: 'dependency_missing'; dependency: string; reason: string }
  | { status: 'configuration_missing'; setting: string; reason: string }
  | { status: 'unsupported_platform'; platform: NodeJS.Platform; reason: string }

const PLACEHOLDER_AVAILABILITY: Record<string, Extract<ToolAvailability, { status: 'dependency_missing' }>> = {
  web_screenshot: {
    status: 'dependency_missing',
    dependency: 'playwright',
    reason: 'Screenshot provider is not implemented or installed.',
  },
  ocr: {
    status: 'dependency_missing',
    dependency: 'ocr-backend',
    reason: 'OCR backend is not configured.',
  },
  image_edit: {
    status: 'dependency_missing',
    dependency: 'image-processing-backend',
    reason: 'Image editing backend is not configured.',
  },
}

export function getToolAvailability(toolId: string): ToolAvailability {
  return PLACEHOLDER_AVAILABILITY[toolId] ?? { status: 'available' }
}

export function isToolAvailable(toolId: string): boolean {
  return getToolAvailability(toolId).status === 'available'
}

export class ToolUnavailableError extends Error {
  constructor(readonly toolId: string, readonly availability: ToolAvailability) {
    super(formatAvailabilityError(toolId, availability))
    this.name = 'ToolUnavailableError'
  }
}

export function requireToolAvailability(toolId: string): void {
  const availability = getToolAvailability(toolId)
  if (availability.status !== 'available') throw new ToolUnavailableError(toolId, availability)
}

function formatAvailabilityError(toolId: string, availability: ToolAvailability): string {
  if (availability.status === 'dependency_missing') {
    return `Tool ${toolId} is unavailable: missing ${availability.dependency}. ${availability.reason}`
  }
  if (availability.status === 'configuration_missing') {
    return `Tool ${toolId} is unavailable: missing setting ${availability.setting}. ${availability.reason}`
  }
  if (availability.status === 'unsupported_platform') {
    return `Tool ${toolId} is unavailable on ${availability.platform}. ${availability.reason}`
  }
  return `Tool ${toolId} is unavailable: ${availability.status === 'available' ? 'unknown reason' : availability.reason}`
}
