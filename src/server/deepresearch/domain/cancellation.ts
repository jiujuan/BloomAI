import { ResearchDomainError } from './errors'

export interface ResearchCancellationSignal {
  signal?: AbortSignal | null
  isCancellationRequested?: (() => boolean) | null
}

/** A typed, non-failure interruption used at every workflow safe boundary. */
export class ResearchCancellationError extends ResearchDomainError {
  constructor(message = 'Deep Research execution was cancelled.') {
    super('RESEARCH_CANCELLED', message, false)
  }
}

export function isCancellationRequested(input: ResearchCancellationSignal = {}): boolean {
  return input.signal?.aborted === true || input.isCancellationRequested?.() === true
}

export function throwIfCancellationRequested(input: ResearchCancellationSignal = {}): void {
  if (isCancellationRequested(input)) throw new ResearchCancellationError()
}

export function cancellationGuard(input: ResearchCancellationSignal = {}): () => void {
  return () => throwIfCancellationRequested(input)
}
