import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUFFER_RATE_LIMIT_DEFAULTS,
  BatchHaltedError,
  BufferRateLimiter,
  FailureBackoffExhaustedError,
  LimiterAbortedError,
} from '../src/limiter'

const rateLimitHeaders = (remaining: string, reset = '2026-06-04T12:15:00.000Z') =>
  new Headers({
    'RateLimit-Limit': '100',
    'RateLimit-Remaining': remaining,
    'RateLimit-Reset': reset,
  })

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

  it('syncs state from Response rate limit headers', async () => {
    const limiter = new BufferRateLimiter()

    await limiter.schedule(async () => {
      return new Response(null, { status: 200, headers: rateLimitHeaders('7') })
    })

    const state = limiter.getState()
    expect(state.rateLimitRemaining).toBe(7)
    expect(state.rateLimitResetAt).toBe(Date.parse('2026-06-04T12:15:00.000Z'))
  })

  it('pauses and retries after HTTP 429 with retryAfter', async () => {
    const limiter = new BufferRateLimiter({ defaultRetryAfterSeconds: 60 })
    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ retryAfter: 5 }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('50') })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    expect(limiter.getState().pausedUntil).not.toBeNull()

    await vi.advanceTimersByTimeAsync(5_000)
    const result = await resultPromise

    expect(attempts).toBe(2)
    expect(result.status).toBe(200)
    expect(limiter.getState().pausedUntil).toBeNull()
    expect(limiter.getState().rateLimitRemaining).toBe(50)
  })

  it('retries transient network errors and refunds the token', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      safetyMargin: 1,
      maxTransientRetries: 2,
      transientRetryBaseDelayMs: 100,
      transientRetryMaxDelayMs: 100,
    })

    vi.spyOn(Math, 'random').mockReturnValue(0)

    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new TypeError('fetch failed')
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('10') })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    expect(limiter.getState().availableTokens).toBe(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(100)
    const result = await resultPromise

    expect(attempts).toBe(3)
    expect(result.status).toBe(200)
    expect(limiter.getState().availableTokens).toBe(1)
  })

  it('retries HTTP 5xx responses with backoff', async () => {
    const limiter = new BufferRateLimiter({
      maxTransientRetries: 2,
      transientRetryBaseDelayMs: 50,
      transientRetryMaxDelayMs: 50,
    })

    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(null, { status: 503 })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('12') })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(50)
    const result = await resultPromise

    expect(attempts).toBe(2)
    expect(result.status).toBe(200)
  })

  it('does not retry HTTP 401 and records failure status', async () => {
    const limiter = new BufferRateLimiter({
      maxTransientRetries: 3,
      failureBackoff: { enabled: true },
    })
    let attempts = 0

    const result = await limiter.schedule(async () => {
      attempts += 1
      return new Response(null, { status: 401 })
    })

    expect(attempts).toBe(1)
    expect(result.status).toBe(401)
    expect(limiter.getState().totalSucceeded).toBe(0)
    expect(limiter.getState().totalFailed).toBe(1)
    expect(limiter.getState().httpStatusCounts['401']).toBe(1)
  })

  it('pauses with failure backoff on HTTP 403 and retries', async () => {
    const limiter = new BufferRateLimiter({
      failureBackoff: { baseDelayMs: 60_000, maxDelayMs: 60_000 },
    })
    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(null, { status: 403 })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('10') })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    expect(limiter.getState().pauseReason).toBe('failure')

    await vi.advanceTimersByTimeAsync(60_000)
    const result = await resultPromise

    expect(attempts).toBe(2)
    expect(result.status).toBe(200)
    expect(limiter.getState().totalSucceeded).toBe(1)
    expect(limiter.getState().totalFailed).toBe(0)
  })

  it('blocks the queue while backing off on the first failure', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      failureBackoff: { baseDelayMs: 60_000, maxDelayMs: 60_000 },
    })
    let firstAttempts = 0
    let secondAttempts = 0

    void limiter.schedule(async () => {
      firstAttempts += 1
      if (firstAttempts === 1) {
        return new Response(null, { status: 403 })
      }
      return new Response(null, { status: 200, headers: rateLimitHeaders('5') })
    })
    void limiter.schedule(async () => {
      secondAttempts += 1
      return new Response(null, { status: 200, headers: rateLimitHeaders('4') })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(firstAttempts).toBe(1)
    expect(secondAttempts).toBe(0)
    expect(limiter.getState().pauseReason).toBe('failure')
  })

  it('halts the batch after the first non-retryable failure', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      failureBackoff: { haltBatchOnFirstFailure: true },
    })
    let attempts = 0

    const first = limiter.schedule(async () => {
      attempts += 1
      return new Response(null, { status: 401 })
    })
    const second = limiter.schedule(async () => new Response(null, { status: 200 }))
    const third = limiter.schedule(async () => new Response(null, { status: 200 }))

    const secondRejected = expect(second).rejects.toBeInstanceOf(BatchHaltedError)
    const thirdRejected = expect(third).rejects.toBeInstanceOf(BatchHaltedError)

    await vi.advanceTimersByTimeAsync(0)
    await first
    await secondRejected
    await thirdRejected

    expect(attempts).toBe(1)
    expect(limiter.getState().totalFailed).toBe(1)
    expect(limiter.getState().batchHalted).toBe(true)
  })

  it('backs off when HTTP 200 includes GraphQL errors', async () => {
    const limiter = new BufferRateLimiter({
      failureBackoff: { baseDelayMs: 30_000, maxDelayMs: 30_000 },
    })
    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ errors: [{ message: 'quota exceeded' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: rateLimitHeaders('1'),
      })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    expect(limiter.getState().pauseReason).toBe('failure')

    await vi.advanceTimersByTimeAsync(30_000)
    const result = await resultPromise

    expect(attempts).toBe(2)
    expect(result.status).toBe(200)
    expect(limiter.getState().totalSucceeded).toBe(1)
  })

  it('fails after exhausting transient retries', async () => {
    const limiter = new BufferRateLimiter({
      maxTransientRetries: 1,
      transientRetryBaseDelayMs: 10,
      transientRetryMaxDelayMs: 10,
    })

    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      throw new TypeError('fetch failed')
    })
    const rejection = expect(resultPromise).rejects.toThrow('fetch failed')

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10)
    await rejection
    expect(attempts).toBe(2)
  })

  it('applies header-driven delay when remaining is at low watermark', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 60_000,
      safetyMargin: 1,
      lowWatermark: 5,
    })

    await limiter.schedule(async () => {
      return new Response(null, {
        status: 200,
        headers: rateLimitHeaders('2', '2026-01-01T00:01:00.000Z'),
      })
    })

    const timestamps: number[] = []
    const second = limiter.schedule(async () => {
      timestamps.push(Date.now())
      return new Response(null, { status: 200, headers: rateLimitHeaders('1') })
    })

    await vi.advanceTimersByTimeAsync(30_000)
    await second

    expect(timestamps[0]).toBeGreaterThanOrEqual(30_000)
  })

  it('aborts a job blocked on failure backoff', async () => {
    const limiter = new BufferRateLimiter({
      failureBackoff: { baseDelayMs: 60_000, maxDelayMs: 60_000, haltBatchOnFirstFailure: false },
    })
    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      return new Response(null, { status: 403 })
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    limiter.abort()
    await expect(resultPromise).rejects.toBeInstanceOf(LimiterAbortedError)
  })

  it('throws when failure backoff hits maxFailureAttempts', async () => {
    const limiter = new BufferRateLimiter({
      failureBackoff: {
        baseDelayMs: 1_000,
        maxDelayMs: 1_000,
        maxFailureAttempts: 2,
        haltBatchOnFirstFailure: false,
      },
    })
    let attempts = 0

    const resultPromise = limiter.schedule(async () => {
      attempts += 1
      return new Response(null, { status: 403 })
    })
    const rejection = expect(resultPromise).rejects.toBeInstanceOf(FailureBackoffExhaustedError)

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(1_000)
    await rejection
    expect(attempts).toBe(3)
  })
})
