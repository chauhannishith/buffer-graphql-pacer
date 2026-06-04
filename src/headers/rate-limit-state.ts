export type RateLimitSnapshot = {
  limit: number
  remaining: number
  resetAt: Date
}

/**
 * Parse Buffer's RateLimit-* response headers.
 * @see https://buffer.com/developers/api
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitSnapshot | null {
  const limitRaw = headers.get('RateLimit-Limit')
  const remainingRaw = headers.get('RateLimit-Remaining')
  const resetRaw = headers.get('RateLimit-Reset')

  if (limitRaw === null || remainingRaw === null || resetRaw === null) {
    return null
  }

  const limit = Number.parseInt(limitRaw, 10)
  const remaining = Number.parseInt(remainingRaw, 10)
  const resetAt = new Date(resetRaw)

  if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(resetAt.getTime())) {
    return null
  }

  return { limit, remaining, resetAt }
}

/**
 * Tracks the latest server-reported rate limit and recommends extra delay
 * when remaining requests drop below a low watermark.
 */
export class RateLimitHeaderTracker {
  private snapshot: RateLimitSnapshot | null = null

  constructor(private readonly lowWatermark: number) {}

  update(headers: Headers): void {
    const parsed = parseRateLimitHeaders(headers)
    if (parsed) {
      this.snapshot = parsed
    }
  }

  getSnapshot(): RateLimitSnapshot | null {
    return this.snapshot
  }

  /**
   * Extra milliseconds to wait before the next request when the server
   * reports a nearly exhausted window.
   */
  getRecommendedDelayMs(now = Date.now()): number {
    if (!this.snapshot || this.snapshot.remaining > this.lowWatermark) {
      return 0
    }

    const msUntilReset = this.snapshot.resetAt.getTime() - now
    if (msUntilReset <= 0) {
      return 0
    }

    if (this.snapshot.remaining <= 0) {
      return msUntilReset
    }

    return Math.ceil(msUntilReset / this.snapshot.remaining)
  }
}
