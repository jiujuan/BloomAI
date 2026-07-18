import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { executeLegacyToolCapability } from '@server/skills/policy/capability-broker'
import type { DiscoveredResearchSource } from './source-curator'

export interface SearchRequest {
  id: string
  query: string
  idempotencyKey?: string
}

export interface SearchExecution {
  queryId: string
  provider: string | null
  candidates: DiscoveredResearchSource[]
  error: { code: string; message: string; retryable: boolean } | null
}

export interface WorkflowToolRequest {
  caller: 'workflow'
  toolId: string
  input: Record<string, unknown>
  sessionId?: string
}

export type WorkflowToolExecutor = (request: WorkflowToolRequest) => Promise<{ output: unknown }>

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|rate.?limit|\b429\b|provider unavailable|\b503\b|temporar/i.test(message)
}

async function retryWithinDeadline<T>(operation: () => Promise<T>, deadlineAt: number | null, sleep: (ms: number) => Promise<void>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (deadlineAt !== null && Date.now() >= deadlineAt) break
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === 2) throw error
      const delay = 100 * 2 ** attempt
      if (deadlineAt !== null && Date.now() + delay >= deadlineAt) break
      await sleep(delay)
    }
  }
  throw lastError ?? new Error('Deep Research search deadline exhausted.')
}

function parseSearchOutput(queryId: string, output: unknown): Omit<SearchExecution, 'error'> {
  const value = output as { provider?: unknown; error?: unknown; results?: unknown }
  if (typeof value?.error === 'string' && value.error) throw new Error(value.error)
  const results = Array.isArray(value?.results) ? value.results : []
  return {
    queryId,
    provider: typeof value?.provider === 'string' ? value.provider : null,
    candidates: results.flatMap((result) => {
      const item = result as { title?: unknown; url?: unknown; snippet?: unknown }
      if (typeof item.url !== 'string' || !item.url) return []
      return [{
        queryId,
        title: typeof item.title === 'string' ? item.title : item.url,
        url: item.url,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
      }]
    }),
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>, isCancelled: () => boolean, onCancelled: (item: T) => R): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = isCancelled() ? onCancelled(items[index]) : await map(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

export function createSearchService(options: { executeTool?: WorkflowToolExecutor; sleep?: (ms: number) => Promise<void>; isCancelled?: (runId: string) => boolean } = {}) {
  const executeTool: WorkflowToolExecutor = options.executeTool ?? executeLegacyToolCapability
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const isCancelled = options.isCancelled ?? (() => false)

  return {
    async search(run: ResearchRunDto, requests: SearchRequest[], requestOptions: { isCancelled?: () => boolean; onExecution?: (execution: SearchExecution) => Promise<void> | void } = {}): Promise<SearchExecution[]> {
      const remainingSourceBudget = Math.max(1, run.budget.maxNormalizedSources - run.usage.normalizedSources)
      const cancelled = requestOptions.isCancelled ?? (() => isCancelled(run.id))
      return mapWithConcurrency(
        requests,
        run.budget.searchConcurrency,
        async (request) => {
          try {
            const result = await retryWithinDeadline(
              () => executeTool({
                caller: 'workflow',
                toolId: 'web_search',
                input: { query: request.query, limit: Math.min(8, remainingSourceBudget), idempotencyKey: request.idempotencyKey ?? request.id },
                sessionId: run.sessionId ?? run.id,
              }),
              run.usage.deadlineAt,
              sleep,
            )
            const execution: SearchExecution = { ...parseSearchOutput(request.id, result.output), error: null }
            await requestOptions.onExecution?.(execution)
            return execution
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const execution: SearchExecution = {
              queryId: request.id,
              provider: null,
              candidates: [],
              error: { code: 'RESEARCH_SEARCH_FAILED', message, retryable: isRetryableError(error) },
            }
            await requestOptions.onExecution?.(execution)
            return execution
          }
        },
        cancelled,
        (request) => ({
          queryId: request.id,
          provider: null,
          candidates: [],
          error: { code: 'RESEARCH_CANCELLED', message: 'Deep Research run was cancelled.', retryable: false },
        }),
      )
    },
  }
}
