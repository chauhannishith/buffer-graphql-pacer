import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferRateLimiter } from '../src/limiter'

const rateLimitHeaders = (remaining: string) =>
  new Headers({
    'RateLimit-Limit': '100',
    'RateLimit-Remaining': remaining,
    'RateLimit-Reset': '2026-06-04T12:15:00.000Z',
  })

describe('BufferRateLimiter telemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks totalScheduled and totalCompleted', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    const first = limiter.schedule(async () => 'a')
    const second = limiter.schedule(async () => 'b')

    expect(limiter.getState().totalScheduled).toBe(2)
    expect(limiter.getState().totalCompleted).toBe(0)

    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([first, second])

    expect(limiter.getState().totalCompleted).toBe(2)
  })

  it('exposes requestsPerMinute and requestBuckets after completions', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    await limiter.schedule(async () => 'done')
    await limiter.schedule(async () => 'done')

    const state = limiter.getState()
    expect(state.requestsPerMinute).toBe(2)
    expect(state.requestBuckets.reduce((sum, count) => sum + count, 0)).toBe(2)
  })

  it('reports pacingStatus paused throttled and stable', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 5,
    })

    expect(limiter.getState().pacingStatus).toBe('stable')

    await limiter.schedule(async () => {
      return new Response(null, { status: 200, headers: rateLimitHeaders('3') })
    })
    expect(limiter.getState().pacingStatus).toBe('throttled')

    let attempts = 0
    const promise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ retryAfter: 5 }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('50') })
    })

    await vi.waitFor(() => {
      expect(limiter.getState().pacingStatus).toBe('paused')
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await promise
    expect(limiter.getState().pacingStatus).toBe('stable')
  })

  it('invokes lifecycle callbacks', async () => {
    const events: string[] = []

    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
      callbacks: {
        onRequestStart: () => events.push('start'),
        onRequestComplete: () => events.push('complete'),
        onRateLimitHeaders: () => events.push('headers'),
        onPause: () => events.push('pause'),
        onResume: () => events.push('resume'),
      },
    })

    let attempts = 0
    const promise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ retryAfter: 2 }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('80') })
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000)
    await promise

    expect(events).toContain('start')
    expect(events).toContain('pause')
    expect(events).toContain('resume')
    expect(events).toContain('headers')
    expect(events).toContain('complete')
  })
})
