import { describe, expect, it } from 'vitest'
import {
  computeFailureBackoffMs,
  responseHasGraphqlErrors,
  shouldFailureBackoff,
} from '../src/backoff/quota-exhaustion'

describe('failure-backoff', () => {
  it('backs off on 4xx except 401 and 429 by default', () => {
    expect(shouldFailureBackoff(403)).toBe(true)
    expect(shouldFailureBackoff(402)).toBe(true)
    expect(shouldFailureBackoff(401)).toBe(false)
    expect(shouldFailureBackoff(429)).toBe(false)
    expect(shouldFailureBackoff(200)).toBe(false)
  })

  it('can include server errors after transient retries', () => {
    expect(shouldFailureBackoff(503, { includeServerErrors: true })).toBe(true)
    expect(shouldFailureBackoff(503, { includeServerErrors: false })).toBe(false)
  })

  it('detects GraphQL errors in HTTP 200 responses', async () => {
    const failing = new Response(JSON.stringify({ errors: [{ message: 'quota exceeded' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const ok = new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(await responseHasGraphqlErrors(failing)).toBe(true)
    expect(await responseHasGraphqlErrors(ok)).toBe(false)
  })

  it('computes exponential backoff capped at 24 hours', () => {
    const fiveMinutes = 5 * 60 * 1000
    const oneDay = 24 * 60 * 60 * 1000

    expect(computeFailureBackoffMs(0, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(
      fiveMinutes,
    )
    expect(computeFailureBackoffMs(1, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(
      fiveMinutes * 2,
    )
    expect(computeFailureBackoffMs(20, { baseDelayMs: fiveMinutes, maxDelayMs: oneDay })).toBe(
      oneDay,
    )
  })
})
