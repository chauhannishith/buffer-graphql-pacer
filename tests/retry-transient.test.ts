import { describe, expect, it } from 'vitest'
import {
  computeTransientBackoffMs,
  isRetryableServerResponse,
  isTransientNetworkError,
} from '../src/backoff/retry-transient'

describe('retry-transient', () => {
  it('detects common transient network errors', () => {
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(true)

    const timeout = new Error('timed out') as NodeJS.ErrnoException
    timeout.code = 'ETIMEDOUT'
    expect(isTransientNetworkError(timeout)).toBe(true)
  })

  it('does not treat abort errors as transient', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isTransientNetworkError(abort)).toBe(false)
  })

  it('flags HTTP 5xx as retryable', () => {
    expect(isRetryableServerResponse(new Response(null, { status: 502 }))).toBe(true)
    expect(isRetryableServerResponse(new Response(null, { status: 400 }))).toBe(false)
  })

  it('computes exponential backoff with deterministic jitter', () => {
    const noJitter = () => 0

    expect(computeTransientBackoffMs(0, { random: noJitter })).toBe(500)
    expect(computeTransientBackoffMs(1, { random: noJitter })).toBe(1_000)
    expect(computeTransientBackoffMs(10, { random: noJitter, maxDelayMs: 8_000 })).toBe(8_000)
  })
})
