import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUFFER_RATE_LIMIT_DEFAULTS, BufferRateLimiter } from '../src/limiter'

describe('BufferRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses buffer defaults for the underlying token bucket', () => {
    const limiter = new BufferRateLimiter()

    expect(limiter.getState().tokenCapacity).toBe(
      BUFFER_RATE_LIMIT_DEFAULTS.maxRequests * BUFFER_RATE_LIMIT_DEFAULTS.safetyMargin,
    )
  })

  it('paces scheduled work through the token bucket', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      safetyMargin: 1,
    })

    const timestamps: number[] = []

    const run = () =>
      limiter.schedule(async () => {
        timestamps.push(Date.now())
      })

    const first = run()
    const second = run()
    const third = run()

    await vi.advanceTimersByTimeAsync(0)
    await first
    await second

    expect(timestamps).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(500)
    await third

    expect(timestamps).toHaveLength(3)
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(400)
  })

  it('exposes queue depth in getState', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 1,
      windowMs: 10_000,
      safetyMargin: 1,
    })

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    void limiter.schedule(async () => {
      await gate
    })
    void limiter.schedule(async () => 'done')

    await vi.waitFor(() => {
      expect(limiter.getState().queueDepth).toBe(1)
    })

    release?.()
    await vi.waitFor(() => {
      expect(limiter.getState().queueDepth).toBe(0)
    })
  })
})
