import { describe, expect, it } from 'vitest'
import { parseRateLimitHeaders, RateLimitHeaderTracker } from '../src/headers/rate-limit-state'

const makeHeaders = (values: Record<string, string>): Headers =>
  new Headers(values)

describe('parseRateLimitHeaders', () => {
  it('parses valid Buffer rate limit headers', () => {
    const headers = makeHeaders({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '42',
      'RateLimit-Reset': '2026-06-04T12:15:00.000Z',
    })

    const snapshot = parseRateLimitHeaders(headers)

    expect(snapshot).toEqual({
      limit: 100,
      remaining: 42,
      resetAt: new Date('2026-06-04T12:15:00.000Z'),
    })
  })

  it('returns null when headers are missing or invalid', () => {
    expect(parseRateLimitHeaders(makeHeaders({}))).toBeNull()
    expect(
      parseRateLimitHeaders(
        makeHeaders({
          'RateLimit-Limit': '100',
          'RateLimit-Remaining': 'nope',
          'RateLimit-Reset': '2026-06-04T12:15:00.000Z',
        }),
      ),
    ).toBeNull()
  })
})

describe('RateLimitHeaderTracker', () => {
  it('returns no delay when remaining is above the low watermark', () => {
    const tracker = new RateLimitHeaderTracker(5)
    tracker.update(
      makeHeaders({
        'RateLimit-Limit': '100',
        'RateLimit-Remaining': '10',
        'RateLimit-Reset': '2026-06-04T12:15:00.000Z',
      }),
    )

    expect(tracker.getRecommendedDelayMs(Date.parse('2026-06-04T12:00:00.000Z'))).toBe(0)
  })

  it('spreads remaining time across remaining requests at low watermark', () => {
    const tracker = new RateLimitHeaderTracker(5)
    tracker.update(
      makeHeaders({
        'RateLimit-Limit': '100',
        'RateLimit-Remaining': '2',
        'RateLimit-Reset': '2026-06-04T12:10:00.000Z',
      }),
    )

    const now = Date.parse('2026-06-04T12:00:00.000Z')
    expect(tracker.getRecommendedDelayMs(now)).toBe(300_000)
  })

  it('waits until reset when remaining is zero', () => {
    const tracker = new RateLimitHeaderTracker(5)
    tracker.update(
      makeHeaders({
        'RateLimit-Limit': '100',
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': '2026-06-04T12:05:00.000Z',
      }),
    )

    const now = Date.parse('2026-06-04T12:00:00.000Z')
    expect(tracker.getRecommendedDelayMs(now)).toBe(300_000)
  })
})
