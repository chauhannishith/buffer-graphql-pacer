import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferRateLimiter, LimiterAbortedError } from '../src/limiter'
import { runPacedWork } from '../src/tui/run-dashboard'

describe('runPacedWork', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs work without dashboard when dashboard is false or omitted', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    let ran = false
    const work = async () => {
      ran = true
    }

    await runPacedWork(limiter, work)
    expect(ran).toBe(true)

    ran = false
    await runPacedWork(limiter, work, { dashboard: false })
    expect(ran).toBe(true)
  })

  it('swallows limiter abort errors from work', async () => {
    const limiter = new BufferRateLimiter({
      failureBackoff: { baseDelayMs: 60_000, haltBatchOnFirstFailure: false },
    })

    const work = async (): Promise<void> => {
      const resultPromise = limiter.schedule(async () => new Response(null, { status: 403 }))
      await vi.advanceTimersByTimeAsync(0)
      limiter.abort()
      await expect(resultPromise).rejects.toBeInstanceOf(LimiterAbortedError)
    }

    await runPacedWork(limiter, work)
  })
})
