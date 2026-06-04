import { JobQueue } from './queue/job-queue'
import { TokenBucket } from './queue/token-bucket'

/** Buffer GraphQL defaults: 100 requests per 15-minute rolling window. */
export const BUFFER_RATE_LIMIT_DEFAULTS = {
  maxRequests: 100,
  windowMs: 15 * 60 * 1000,
  safetyMargin: 0.9,
} as const

export type BufferRateLimiterOptions = {
  maxRequests?: number
  windowMs?: number
  safetyMargin?: number
}

export type BufferRateLimiterState = {
  queueDepth: number
  availableTokens: number
  tokenCapacity: number
}

/**
 * Queues async work and drains it through a token bucket so outbound calls
 * stay below Buffer's rolling rate limit.
 */
export class BufferRateLimiter {
  private readonly bucket: TokenBucket
  private readonly queue = new JobQueue()

  constructor(options: BufferRateLimiterOptions = {}) {
    this.bucket = new TokenBucket({
      maxRequests: options.maxRequests ?? BUFFER_RATE_LIMIT_DEFAULTS.maxRequests,
      windowMs: options.windowMs ?? BUFFER_RATE_LIMIT_DEFAULTS.windowMs,
      safetyMargin: options.safetyMargin ?? BUFFER_RATE_LIMIT_DEFAULTS.safetyMargin,
    })
  }

  /**
   * Enqueue work that will run after a token is available.
   * Jobs run one at a time in FIFO order.
   */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.enqueue(async () => {
      await this.bucket.acquire()
      return fn()
    })
  }

  getState(): BufferRateLimiterState {
    return {
      queueDepth: this.queue.getDepth(),
      availableTokens: this.bucket.getAvailableTokens(),
      tokenCapacity: this.bucket.getCapacity(),
    }
  }
}
