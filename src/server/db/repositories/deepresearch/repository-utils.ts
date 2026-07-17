import type { JsonObject, JsonValue, ResearchUsageDto } from '@shared/deepresearch/contracts'

export function decodeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function encodeJson(value: JsonValue | object): string {
  return JSON.stringify(value)
}

export function initialResearchUsage(): ResearchUsageDto {
  return {
    questions: 0,
    iterations: 0,
    searchQueries: 0,
    normalizedSources: 0,
    fetchedSources: 0,
    tokens: 0,
    providerCostUsd: 0,
    startedAt: null,
    deadlineAt: null,
  }
}

export const EMPTY_JSON_OBJECT: JsonObject = {}
