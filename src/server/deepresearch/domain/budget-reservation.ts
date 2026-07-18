import type {
  ResearchBudgetAvailabilityDto,
  ResearchBudgetDto,
  ResearchBudgetReservationDto,
  ResearchBudgetSettlementDto,
  ResearchBudgetSnapshotDto,
  ResearchUsageDto,
} from '@shared/deepresearch/contracts'
import { ResearchDomainError } from './errors'

const RESERVATION_KEYS = ['iterations', 'searchQueries', 'fetchedSources', 'modelTokens', 'providerCostUsd'] as const
type ReservationKey = typeof RESERVATION_KEYS[number]

export interface ReserveBudgetInput {
  budget: ResearchBudgetDto
  usage: ResearchUsageDto
  existingReservations: readonly ResearchBudgetReservationDto[]
  requested: ResearchBudgetReservationDto
}

export interface BudgetReservationResult {
  ok: boolean
  exhausted: ReservationKey[]
  before: ResearchBudgetSnapshotDto
  snapshot: ResearchBudgetSnapshotDto
}

const EMPTY_RESERVATION: ResearchBudgetReservationDto = Object.freeze({
  iterations: 0,
  searchQueries: 0,
  fetchedSources: 0,
  modelTokens: 0,
  providerCostUsd: 0,
})

export function emptyBudgetReservation(): ResearchBudgetReservationDto {
  return { ...EMPTY_RESERVATION }
}

function assertReservation(value: ResearchBudgetReservationDto, name: string): void {
  for (const key of RESERVATION_KEYS) {
    const amount = value[key]
    if (!Number.isFinite(amount) || amount < 0 || (key !== 'providerCostUsd' && !Number.isInteger(amount))) {
      throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', `${name}.${key} must be a non-negative ${key === 'providerCostUsd' ? 'number' : 'integer'}.`, false)
    }
  }
}

export function addBudgetReservations(values: readonly ResearchBudgetReservationDto[]): ResearchBudgetReservationDto {
  const total = emptyBudgetReservation()
  for (const value of values) {
    assertReservation(value, 'reservation')
    for (const key of RESERVATION_KEYS) total[key] += value[key]
  }
  return total
}

function consumedReservation(usage: ResearchUsageDto): ResearchBudgetReservationDto {
  return {
    iterations: usage.iterations,
    searchQueries: usage.searchQueries,
    fetchedSources: usage.fetchedSources,
    modelTokens: usage.tokens,
    providerCostUsd: usage.providerCostUsd,
  }
}

function availabilityFor(budget: ResearchBudgetDto, consumed: ResearchBudgetReservationDto, reserved: ResearchBudgetReservationDto): ResearchBudgetAvailabilityDto {
  return {
    iterations: budget.maxIterations - consumed.iterations - reserved.iterations,
    searchQueries: budget.maxSearchQueries - consumed.searchQueries - reserved.searchQueries,
    fetchedSources: budget.maxFetchedSources - consumed.fetchedSources - reserved.fetchedSources,
    modelTokens: budget.maxTokens === undefined ? null : budget.maxTokens - consumed.modelTokens - reserved.modelTokens,
    providerCostUsd: budget.maxProviderCostUsd === undefined ? null : budget.maxProviderCostUsd - consumed.providerCostUsd - reserved.providerCostUsd,
  }
}

export function createBudgetSnapshot(
  budget: ResearchBudgetDto,
  usage: ResearchUsageDto,
  reservations: readonly ResearchBudgetReservationDto[],
): ResearchBudgetSnapshotDto {
  const consumed = consumedReservation(usage)
  const reserved = addBudgetReservations(reservations)
  return { consumed, reserved, available: availabilityFor(budget, consumed, reserved) }
}

function exhaustedKeys(available: ResearchBudgetAvailabilityDto): ReservationKey[] {
  return RESERVATION_KEYS.filter((key) => available[key] !== null && (available[key] as number) < 0)
}

/**
 * Computes a reservation without side effects. The returned snapshot already includes
 * the requested reservation, so callers can persist it before executing any provider work.
 */
export function reserveBudget(input: ReserveBudgetInput): BudgetReservationResult {
  assertReservation(input.requested, 'requested')
  const before = createBudgetSnapshot(input.budget, input.usage, input.existingReservations)
  const requestedSnapshot = createBudgetSnapshot(input.budget, input.usage, [...input.existingReservations, input.requested])
  const exhausted = exhaustedKeys(requestedSnapshot.available)
  return { ok: exhausted.length === 0, exhausted, before, snapshot: requestedSnapshot }
}

/**
 * Converts a reservation into persisted actual usage and an explicit release amount.
 * A cancelled or failed iteration may settle all-zero usage and therefore release all
 * reserved capacity.
 */
export function settleBudgetReservation(
  reserved: ResearchBudgetReservationDto,
  actual: ResearchBudgetReservationDto,
): ResearchBudgetSettlementDto {
  assertReservation(reserved, 'reserved')
  assertReservation(actual, 'actual')
  for (const key of RESERVATION_KEYS) {
    if (actual[key] > reserved[key]) {
      throw new ResearchDomainError('RESEARCH_VALIDATION_ERROR', `Actual ${key} exceeds its reservation.`, false)
    }
  }

  const released = emptyBudgetReservation()
  for (const key of RESERVATION_KEYS) released[key] = reserved[key] - actual[key]
  return { spent: { ...actual }, released }
}

export function applyBudgetSettlementToUsage(usage: ResearchUsageDto, settlement: ResearchBudgetSettlementDto): ResearchUsageDto {
  return {
    ...usage,
    iterations: usage.iterations + settlement.spent.iterations,
    searchQueries: usage.searchQueries + settlement.spent.searchQueries,
    fetchedSources: usage.fetchedSources + settlement.spent.fetchedSources,
    tokens: usage.tokens + settlement.spent.modelTokens,
    providerCostUsd: usage.providerCostUsd + settlement.spent.providerCostUsd,
  }
}
