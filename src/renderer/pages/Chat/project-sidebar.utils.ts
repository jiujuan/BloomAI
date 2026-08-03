export function nextRecentVisibleCount(current: number, total: number): number {
  if (total <= 0 || current >= total) return Math.max(0, total)
  return Math.min(total, Math.max(15, current * 2))
}

export function visibleProjectCount(total: number, expanded: boolean): number {
  return expanded ? total : Math.min(total, 6)
}

export function shouldShowProjectSessionsMore(total: number, expanded: boolean): boolean {
  return total > 10 && !expanded
}