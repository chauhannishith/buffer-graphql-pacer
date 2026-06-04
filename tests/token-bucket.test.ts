import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenBucket } from '../src/queue/token-bucket'

const WINDOW_MS = 15 * 60 * 1000

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes capacity from maxRequests and safety margin', () => {
    const bucket = new TokenBucket({
      maxRequests: 100,
      windowMs: WINDOW_MS,
      safetyMargin: 0.9,
    })

    expect(bucket.getCapacity()).toBe(90)
    expect(bucket.getAvailableTokens()).toBe(90)
  })

  it('tryConsume returns false when the bucket is empty', () => {
    const bucket = new TokenBucket({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
    })

    for (let i = 0; i < 10; i++) {
      expect(bucket.tryConsume()).toBe(true)
    }
    expect(bucket.tryConsume()).toBe(false)
  })

  it('refills tokens continuously over the window', () => {
    const bucket = new TokenBucket({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
    })

    for (let i = 0; i < 100; i++) {
      bucket.tryConsume()
    }
    expect(bucket.getAvailableTokens()).toBe(0)

    vi.advanceTimersByTime(5_000)
    expect(bucket.getAvailableTokens()).toBeCloseTo(50, 0)

    vi.advanceTimersByTime(5_000)
    expect(bucket.getAvailableTokens()).toBeCloseTo(100, 0)
  })

  it('acquire waits until tokens refill', async () => {
    const bucket = new TokenBucket({
      maxRequests: 10,
      windowMs: 1_000,
      safetyMargin: 1,
    })

    for (let i = 0; i < 10; i++) {
      bucket.tryConsume()
    }

    let acquired = false
    const acquirePromise = bucket.acquire().then(() => {
      acquired = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(acquired).toBe(false)

    await vi.advanceTimersByTimeAsync(100)
    await acquirePromise
    expect(acquired).toBe(true)
  })
})
