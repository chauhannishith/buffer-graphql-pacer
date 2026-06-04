export type TokenBucketOptions = {
  /** Maximum requests allowed per rolling window (Buffer default: 100). */
  maxRequests: number
  /** Rolling window length in milliseconds (Buffer default: 15 minutes). */
  windowMs: number
  /**
   * Fraction of maxRequests to treat as bucket capacity (default 0.9).
   * Leaves headroom below the hard API ceiling.
   */
  safetyMargin?: number
}

const DEFAULT_SAFETY_MARGIN = 0.9

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Token bucket for proactive pacing before hitting Buffer's rate limit.
 * Tokens refill continuously over the configured rolling window.
 */
export class TokenBucket {
  private readonly capacity: number
  private readonly refillPerMs: number
  private tokens: number
  private lastRefillMs: number

  constructor(options: TokenBucketOptions) {
    const margin = options.safetyMargin ?? DEFAULT_SAFETY_MARGIN
    this.capacity = options.maxRequests * margin
    this.refillPerMs = this.capacity / options.windowMs
    this.tokens = this.capacity
    this.lastRefillMs = Date.now()
  }

  getCapacity(): number {
    return this.capacity
  }

  /** Tokens available after applying any elapsed refill. */
  getAvailableTokens(): number {
    this.refill(Date.now())
    return this.tokens
  }

  /**
   * Attempt to consume tokens without waiting.
   * @returns true when tokens were deducted, false when insufficient.
   */
  tryConsume(cost = 1): boolean {
    const now = Date.now()
    this.refill(now)
    if (this.tokens < cost) {
      return false
    }
    this.tokens -= cost
    return true
  }

  /** Wait until at least `cost` tokens are available, then consume them. */
  async acquire(cost = 1): Promise<void> {
    while (!this.tryConsume(cost)) {
      const waitMs = this.msUntilAvailable(cost)
      await delay(Math.max(waitMs, 1))
    }
  }

  /** Milliseconds until `cost` tokens are available (0 if already available). */
  msUntilAvailable(cost: number): number {
    const now = Date.now()
    this.refill(now)
    if (this.tokens >= cost) {
      return 0
    }
    const deficit = cost - this.tokens
    return Math.ceil(deficit / this.refillPerMs)
  }

  private refill(now: number): void {
    const elapsed = now - this.lastRefillMs
    if (elapsed <= 0) {
      return
    }
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefillMs = now
  }
}
