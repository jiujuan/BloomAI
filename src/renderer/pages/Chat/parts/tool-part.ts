// Normalizes AI SDK v6 tool parts (typed `tool-<name>` and `dynamic-tool`) into a
// shape the tool cards render. Kept defensive (any) because part typing varies by
// whether the tool was statically or dynamically registered.

export type ToolCallView = {
  toolCallId: string
  name: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: Record<string, unknown>
  output?: any
  errorText?: string
}

export type ToolStatus = 'running' | 'success' | 'error' | 'permission'

export function isToolPart(part: any): boolean {
  return !!part && typeof part.type === 'string' && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
}

export function toToolCallView(part: any): ToolCallView {
  const name = part.type === 'dynamic-tool' ? String(part.toolName || 'tool') : String(part.type).slice('tool-'.length)
  return {
    toolCallId: part.toolCallId || part.toolName || name,
    name,
    state: part.state || 'input-available',
    input: part.input && typeof part.input === 'object' ? part.input : undefined,
    output: part.output,
    errorText: part.errorText,
  }
}

export function toolStatus(call: ToolCallView): ToolStatus {
  if (call.state === 'output-error') return 'error'
  if (call.state === 'output-available') {
    if (isPermissionDenied(call.output)) return 'permission'
    if (call.output && typeof call.output === 'object' && typeof call.output.error === 'string' && call.output.error) return 'error'
    return 'success'
  }
  return 'running'
}

export function isPermissionDenied(output: any): boolean {
  return !!output && typeof output === 'object' && output.permissionRequired === true
}

/** Best-effort one-line summary of a tool input (query/url/path/command first). */
export function summarizeInput(input?: Record<string, unknown>): string {
  if (!input) return ''
  for (const key of ['query', 'url', 'path', 'pattern', 'command', 'prompt', 'code']) {
    const value = input[key]
    if (typeof value === 'string' && value) return `${key}: ${truncate(value, 100)}`
  }
  const [key, value] = Object.entries(input)[0] ?? []
  if (!key) return ''
  return `${key}: ${truncate(typeof value === 'string' ? value : JSON.stringify(value), 100)}`
}

/** Best-effort one-line summary of a tool output, with web_search specifics. */
export function summarizeOutput(output: any): string | undefined {
  if (output == null) return undefined
  if (typeof output === 'string') return truncate(output, 140)
  if (typeof output !== 'object') return String(output)
  if (Array.isArray(output.results)) {
    const total = typeof output.total === 'number' ? output.total : output.results.length
    const provider = typeof output.provider === 'string' ? output.provider : undefined
    const fallbackFrom = typeof output.fallbackFrom === 'string' ? output.fallbackFrom : undefined
    if (provider && fallbackFrom) return `${total} results · ${fallbackFrom} → ${provider}`
    if (provider) return `${total} results · ${provider}`
    return `${total} results`
  }
  if (typeof output.summary === 'string') return truncate(output.summary, 140)
  if (typeof output.text === 'string') return truncate(output.text, 140)
  if (typeof output.outputPath === 'string') return output.outputPath
  return undefined
}

export type ResultLink = { title: string; url: string }

export function extractResultLinks(output: any, limit = 3): ResultLink[] {
  if (!output || !Array.isArray(output.results)) return []
  return output.results
    .filter((r: any) => r && typeof r.url === 'string' && r.url)
    .slice(0, limit)
    .map((r: any) => ({ title: typeof r.title === 'string' && r.title ? r.title : r.url, url: r.url }))
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}
