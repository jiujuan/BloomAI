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

// Mastra-internal tools that run as silent background side-effects.
// They must never appear as tool cards in the chat UI.
const MASTRA_INTERNAL_TOOLS = new Set([
  'updateWorkingMemory', // working memory schema update
  'recall',              // observational memory retrieval
])

function getToolName(part: any): string {
  return part.type === 'dynamic-tool'
    ? String(part.toolName || 'tool')
    : String(part.type).slice('tool-'.length)
}

export function isToolPart(part: any): boolean {
  if (!part || typeof part.type !== 'string') return false
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return false
  return !MASTRA_INTERNAL_TOOLS.has(getToolName(part))
}

export function toToolCallView(part: any): ToolCallView {
  const name = getToolName(part)
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

// ── Persistence: slim a finished assistant message's UI parts before storing in SQLite ──
// The cards only consume summarizeInput / summarizeOutput / extractResultLinks(top 3), so we
// can drop heavy raw fields (full result bodies, large blobs) without changing what renders.

const MAX_RESULTS = 10
const MAX_STR = 500
const MAX_REASONING = 4000

function slimString(value: unknown, max = MAX_STR): unknown {
  return typeof value === 'string' ? truncate(value, max) : value
}

/** Slim a tool output to the fields the cards render (results→title/url/snippet, summaries). */
function slimToolOutput(output: any): any {
  if (output == null || typeof output !== 'object') return slimString(output)
  const slim: Record<string, unknown> = {}
  if (Array.isArray(output.results)) {
    slim.results = output.results.slice(0, MAX_RESULTS).map((r: any) => ({
      ...(r?.title ? { title: truncate(String(r.title), 200) } : {}),
      ...(r?.url ? { url: String(r.url) } : {}),
      ...(typeof r?.snippet === 'string' ? { snippet: truncate(r.snippet, 200) } : {}),
    }))
  }
  for (const key of ['total', 'provider', 'fallbackFrom', 'outputPath', 'permissionRequired', 'error']) {
    if (output[key] !== undefined) slim[key] = slimString(output[key])
  }
  for (const key of ['summary', 'text']) {
    if (typeof output[key] === 'string') slim[key] = truncate(output[key], MAX_STR)
  }
  return slim
}

/** Bound the size of assistant UI parts for storage; lossless for what the cards display. */
export function slimParts(parts: any[]): any[] {
  if (!Array.isArray(parts)) return []
  return parts
    .filter((part) => {
      if (!part || typeof part.type !== 'string') return true
      // Drop Mastra-internal tool parts entirely — they're background side-effects,
      // not UI content, and storing them wastes SQLite space.
      if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
        return !MASTRA_INTERNAL_TOOLS.has(getToolName(part))
      }
      return true
    })
    .map((part) => {
      if (!part || typeof part.type !== 'string') return part
      if (part.type === 'reasoning') {
        return { ...part, text: typeof part.text === 'string' ? truncate(part.text, MAX_REASONING) : part.text }
      }
      if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
        return { ...part, output: part.output !== undefined ? slimToolOutput(part.output) : part.output }
      }
      return part
    })
}
