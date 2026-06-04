import { parseRetryAfterSeconds, PauseGate } from './backoff/retry-429'
import { RateLimitHeaderTracker } from './headers/rate-limit-state'
import { JobQueue } from './queue/job-queue'
import { TokenBucket } from './queue/token-bucket'

/** Buffer GraphQL defaults: 100 requests per 15-minute rolling window. */
export const BUFFER_RATE_LIMIT_DEFAULTS = {
  maxRequests: 100,
  windowMs: 15 * 60 * 1000,
  safetyMargin: 0.9,
  lowWatermark: 5,
  defaultRetryAfterSeconds: 60,
} as const

export type BufferRateLimiterOptions = {
  maxRequests?: number
  windowMs?: number
  safetyMargin?: number
  /** When RateLimit-Remaining falls at or below this, add header-driven delay. */
  lowWatermark?: number
  /** Used when a 429 response has no parseable retryAfter value. */
  defaultRetryAfterSeconds?: number
}

export type BufferRateLimiterState = {
  queueDepth: number
  availableTokens: number
  tokenCapacity: number
  pausedUntil: number | null
  rateLimitRemaining: number | null
  rateLimitResetAt: number | null
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const isFetchResponse = (value: unknown): value is Response =>
  typeof value === 'object' &&
  value !== null &&
  'headers' in value &&
  'status' in value &&
  typeof (value as Response).headers.get === 'function'

/**
 * Queues async work and drains it through a token bucket so outbound calls
 * stay below Buffer's rolling rate limit.
 */
export class BufferRateLimiter {
  private readonly bucket: TokenBucket
  private readonly queue = new JobQueue()
  private readonly headerTracker: RateLimitHeaderTracker
  private readonly pauseGate = new PauseGate()
  private readonly defaultRetryAfterSeconds: number

  constructor(options: BufferRateLimiterOptions = {}) {
    this.bucket = new TokenBucket({
      maxRequests: options.maxRequests ?? BUFFER_RATE_LIMIT_DEFAULTS.maxRequests,
      windowMs: options.windowMs ?? BUFFER_RATE_LIMIT_DEFAULTS.windowMs,
      safetyMargin: options.safetyMargin ?? BUFFER_RATE_LIMIT_DEFAULTS.safetyMargin,
    })
    this.headerTracker = new RateLimitHeaderTracker(
      options.lowWatermark ?? BUFFER_RATE_LIMIT_DEFAULTS.lowWatermark,
    )
    this.defaultRetryAfterSeconds =
      options.defaultRetryAfterSeconds ?? BUFFER_RATE_LIMIT_DEFAULTS.defaultRetryAfterSeconds
  }

  /**
   * Enqueue work that will run after a token is available.
   * Jobs run one at a time in FIFO order.
   *
   * When the scheduled function returns a `Response`, the limiter:
   * - syncs pacing from `RateLimit-*` headers on success
   * - pauses and retries after HTTP 429 using `retryAfter`
   */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.enqueue(() => this.runWithRateControl(fn))
  }

  /**
   * Manually record rate-limit headers from a response (for non-Response results).
   */
  observeResponse(response: Response): void {
    if (response.status === 429) {
      return
    }
    this.headerTracker.update(response.headers)
  }

  getState(): BufferRateLimiterState {
    const snapshot = this.headerTracker.getSnapshot()
    return {
      queueDepth: this.queue.getDepth(),
      availableTokens: this.bucket.getAvailableTokens(),
      tokenCapacity: this.bucket.getCapacity(),
      pausedUntil: this.pauseGate.getPausedUntil(),
      rateLimitRemaining: snapshot?.remaining ?? null,
      rateLimitResetAt: snapshot?.resetAt.getTime() ?? null,
    }
  }

  private async runWithRateControl<T>(fn: () => Promise<T>): Promise<T> {
    while (true) {
      await this.pauseGate.wait()

      const headerDelay = this.headerTracker.getRecommendedDelayMs()
      if (headerDelay > 0) {
        await delay(headerDelay)
      }

      await this.bucket.acquire()
      const result = await fn()

      if (!isFetchResponse(result)) {
        return result
      }

      if (result.status === 429) {
        const retryAfterSeconds =
          (await parseRetryAfterSeconds(result)) ?? this.defaultRetryAfterSeconds
        this.pauseGate.pauseFor(retryAfterSeconds * 1000)
        continue
      }

      this.headerTracker.update(result.headers)
      return result
    }
  }
}
