export const QUOTA_EXHAUSTION_DEFAULTS = {
  /** HTTP statuses treated as plan/daily quota exhaustion (not rolling 429). */
  statuses: [403] as number[],
  baseDelayMs: 5 * 60 * 1000,
  maxDelayMs: 24 * 60 * 60 * 1000,
} as const

export type QuotaExhaustionBackoffOptions = {
  enabled?: boolean
  statuses?: number[]
  baseDelayMs?: number
  maxDelayMs?: number
}

export const isQuotaExhaustionStatus = (
  status: number,
  statuses: readonly number[] = QUOTA_EXHAUSTION_DEFAULTS.statuses,
): boolean => statuses.includes(status)

/**
 * Exponential wait before retrying after daily/plan quota errors.
 * Delay per pause is capped at `maxDelayMs` (default 24 hours).
 */
export const computeQuotaBackoffMs = (
  attempt: number,
  options: QuotaExhaustionBackoffOptions = {},
): number => {
  const baseDelayMs = options.baseDelayMs ?? QUOTA_EXHAUSTION_DEFAULTS.baseDelayMs
  const maxDelayMs = options.maxDelayMs ?? QUOTA_EXHAUSTION_DEFAULTS.maxDelayMs
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
}
