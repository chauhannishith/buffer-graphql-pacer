import { describe, expect, it } from 'vitest'
import { computeQuotaBackoffMs, isQuotaExhaustionStatus } from '../src/backoff/quota-exhaustion'

describe('quota-exhaustion', () => {
  it('detects default quota exhaustion statuses', () => {
    expect(isQuotaExhaustionStatus(403)).toBe(true)
    expect(isQuotaExhaustionStatus(429)).toBe(false)
    expect(isQuotaExhaustionStatus(401)).toBe(false)
  })

  it('computes exponential backoff capped at 24 hours', () => {
    const fiveMinutes = 5 * 60 * 1000
    const oneDay = 24 * 60 * 60 * 1000

    expect(computeQuotaBackoffMs(0, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(
      fiveMinutes,
    )
    expect(computeQuotaBackoffMs(1, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(
      tenMinutes(fiveMinutes),
    )
    expect(computeQuotaBackoffMs(20, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(oneDay)
  })
})

const tenMinutes = (fiveMinutes: number): number => fiveMinutes * 2
