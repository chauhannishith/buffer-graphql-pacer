import { parseRetryAfterSeconds, PauseGate } from './backoff/retry-429'
import {
  computeQuotaBackoffMs,
  isQuotaExhaustionStatus,
  QUOTA_EXHAUSTION_DEFAULTS,
  type QuotaExhaustionBackoffOptions,
} from './backoff/quota-exhaustion'
import {
  computeTransientBackoffMs,
  isRetryableServerResponse,
  isTransientNetworkError,
  TRANSIENT_RETRY_DEFAULTS,
  type TransientBackoffOptions,
} from './backoff/retry-transient'
import { RateLimitHeaderTracker } from './headers/rate-limit-state'
import type { RateLimitSnapshot } from './headers/rate-limit-state'
import { JobQueue } from './queue/job-queue'
import { TokenBucket } from './queue/token-bucket'
import { RequestMetrics } from './telemetry/request-metrics'

/** Buffer GraphQL defaults: 100 requests per 15-minute rolling window. */
export const BUFFER_RATE_LIMIT_DEFAULTS = {
  maxRequests: 100,
  windowMs: 15 * 60 * 1000,
  safetyMargin: 0.9,
  lowWatermark: 5,
  defaultRetryAfterSeconds: 60,
} as const

export type PacingStatus = 'stable' | 'throttled' | 'paused'

export type PauseReason = 'rate_limit' | 'quota' | null

export type BufferRateLimiterCallbacks = {
  onRequestStart?: () => void
  onRequestComplete?: (info: { completedAt: number }) => void
  onRateLimitHeaders?: (snapshot: RateLimitSnapshot) => void
  onPause?: (info: { pausedUntil: number; retryAfterSeconds: number }) => void
  onResume?: () => void
  onTransientRetry?: (info: {
    attempt: number
    reason: 'network' | 'server'
    delayMs: number
    error?: unknown
    status?: number
  }) => void
  onQuotaWait?: (info: {
    attempt: number
    delayMs: number
    pausedUntil: number
    status: number
  }) => void
}

export type BufferRateLimiterOptions = {
  maxRequests?: number
  windowMs?: number
  safetyMargin?: number
  /** When RateLimit-Remaining falls at or below this, add header-driven delay. */
  lowWatermark?: number
  /** Used when a 429 response has no parseable retryAfter value. */
  defaultRetryAfterSeconds?: number
  /** Retries after network errors or HTTP 5xx before failing the scheduled job. */
  maxTransientRetries?: number
  transientRetryBaseDelayMs?: number
  transientRetryMaxDelayMs?: number
  /** Pause and retry when daily/plan quota responses are returned (default: HTTP 403). */
  quotaExhaustionBackoff?: QuotaExhaustionBackoffOptions
  callbacks?: BufferRateLimiterCallbacks
}

export type BufferRateLimiterState = {
  queueDepth: number
  availableTokens: number
  tokenCapacity: number
  pausedUntil: number | null
  rateLimitRemaining: number | null
  rateLimitResetAt: number | null
  rateLimitLimit: number | null
  totalScheduled: number
  totalCompleted: number
  /** HTTP 2xx completions (Response results only). */
  totalSucceeded: number
  /** HTTP non-2xx completions (Response results only). */
  totalFailed: number
  /** Count of finished HTTP responses keyed by status code. */
  httpStatusCounts: Record<string, number>
  pauseReason: PauseReason
  inFlight: boolean
  requestsPerMinute: number
  pacingStatus: PacingStatus
  /** Rolling per-second buckets for terminal sparklines (oldest first). */
  requestBuckets: number[]
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
  private readonly metrics = new RequestMetrics()
  private readonly callbacks: BufferRateLimiterCallbacks
  private readonly lowWatermark: number
  private readonly defaultRetryAfterSeconds: number
  private readonly maxTransientRetries: number
  private readonly transientBackoffOptions: TransientBackoffOptions
  private readonly quotaExhaustionBackoff: Required<
    Pick<QuotaExhaustionBackoffOptions, 'enabled' | 'statuses' | 'baseDelayMs' | 'maxDelayMs'>
  >

  private totalScheduled = 0
  private totalCompleted = 0
  private totalSucceeded = 0
  private totalFailed = 0
  private readonly httpStatusCounts: Record<string, number> = {}
  private quotaBackoffAttempt = 0
  private pauseReason: PauseReason = null
  private inFlight = false

  constructor(options: BufferRateLimiterOptions = {}) {
    this.bucket = new TokenBucket({
      maxRequests: options.maxRequests ?? BUFFER_RATE_LIMIT_DEFAULTS.maxRequests,
      windowMs: options.windowMs ?? BUFFER_RATE_LIMIT_DEFAULTS.windowMs,
      safetyMargin: options.safetyMargin ?? BUFFER_RATE_LIMIT_DEFAULTS.safetyMargin,
    })
    this.lowWatermark = options.lowWatermark ?? BUFFER_RATE_LIMIT_DEFAULTS.lowWatermark
    this.headerTracker = new RateLimitHeaderTracker(this.lowWatermark)
    this.defaultRetryAfterSeconds =
      options.defaultRetryAfterSeconds ?? BUFFER_RATE_LIMIT_DEFAULTS.defaultRetryAfterSeconds
    this.maxTransientRetries = options.maxTransientRetries ?? TRANSIENT_RETRY_DEFAULTS.maxRetries
    this.transientBackoffOptions = {
      baseDelayMs: options.transientRetryBaseDelayMs ?? TRANSIENT_RETRY_DEFAULTS.baseDelayMs,
      maxDelayMs: options.transientRetryMaxDelayMs ?? TRANSIENT_RETRY_DEFAULTS.maxDelayMs,
    }
    const quotaOptions = options.quotaExhaustionBackoff ?? {}
    this.quotaExhaustionBackoff = {
      enabled: quotaOptions.enabled ?? true,
      statuses: quotaOptions.statuses ?? [...QUOTA_EXHAUSTION_DEFAULTS.statuses],
      baseDelayMs: quotaOptions.baseDelayMs ?? QUOTA_EXHAUSTION_DEFAULTS.baseDelayMs,
      maxDelayMs: quotaOptions.maxDelayMs ?? QUOTA_EXHAUSTION_DEFAULTS.maxDelayMs,
    }
    this.callbacks = options.callbacks ?? {}
  }

  /**
   * Enqueue work that will run after a token is available.
   * Jobs run one at a time in FIFO order.
   *
   * When the scheduled function returns a `Response`, the limiter:
   * - syncs pacing from `RateLimit-*` headers on success
   * - pauses and retries after HTTP 429 using `retryAfter`
   * - pauses with exponential backoff (up to 24h) on quota exhaustion (default: HTTP 403)
   * - retries transient network errors and HTTP 5xx with exponential backoff
   */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    this.totalScheduled += 1
    return this.queue.enqueue(() => this.runWithRateControl(fn))
  }

  /**
   * Manually record rate-limit headers from a response (for non-Response results).
   */
  observeResponse(response: Response): void {
    if (response.status === 429) {
      return
    }
    this.syncHeaders(response.headers)
  }

  getState(): BufferRateLimiterState {
    const snapshot = this.headerTracker.getSnapshot()
    const now = Date.now()
    const pausedUntil = this.pauseGate.getPausedUntil(now)

    return {
      queueDepth: this.queue.getDepth(),
      availableTokens: this.bucket.getAvailableTokens(),
      tokenCapacity: this.bucket.getCapacity(),
      pausedUntil,
      rateLimitRemaining: snapshot?.remaining ?? null,
      rateLimitResetAt: snapshot?.resetAt.getTime() ?? null,
      rateLimitLimit: snapshot?.limit ?? null,
      totalScheduled: this.totalScheduled,
      totalCompleted: this.totalCompleted,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
      httpStatusCounts: { ...this.httpStatusCounts },
      pauseReason: this.pauseReason,
      inFlight: this.inFlight,
      requestsPerMinute: this.metrics.getRequestsPerMinute(now),
      pacingStatus: this.resolvePacingStatus(snapshot, pausedUntil, now),
      requestBuckets: this.metrics.getBucketCounts(now),
    }
  }

  private resolvePacingStatus(
    snapshot: RateLimitSnapshot | null,
    pausedUntil: number | null,
    now: number,
  ): PacingStatus {
    if (pausedUntil !== null) {
      return 'paused'
    }
    if (
      snapshot !== null &&
      (snapshot.remaining <= this.lowWatermark || this.headerTracker.getRecommendedDelayMs(now) > 0)
    ) {
      return 'throttled'
    }
    return 'stable'
  }

  private syncHeaders(headers: Headers): void {
    this.headerTracker.update(headers)
    const snapshot = this.headerTracker.getSnapshot()
    if (snapshot) {
      this.callbacks.onRateLimitHeaders?.(snapshot)
    }
  }

  private async runWithRateControl<T>(fn: () => Promise<T>): Promise<T> {
    let transientAttempts = 0

    while (true) {
      const wasPaused = this.pauseGate.getPausedUntil() !== null
      await this.pauseGate.wait()
      if (wasPaused) {
        this.pauseReason = null
        this.callbacks.onResume?.()
      }

      const headerDelay = this.headerTracker.getRecommendedDelayMs()
      if (headerDelay > 0) {
        await delay(headerDelay)
      }

      await this.bucket.acquire()

      this.inFlight = true
      this.callbacks.onRequestStart?.()

      try {
        const result = await fn()

        if (!isFetchResponse(result)) {
          this.completeRequest()
          return result
        }

        if (result.status === 429) {
          const retryAfterSeconds =
            (await parseRetryAfterSeconds(result)) ?? this.defaultRetryAfterSeconds
          const pausedUntil = Date.now() + retryAfterSeconds * 1000
          this.pauseReason = 'rate_limit'
          this.pauseGate.pauseFor(retryAfterSeconds * 1000)
          this.callbacks.onPause?.({ pausedUntil, retryAfterSeconds })
          continue
        }

        if (
          this.quotaExhaustionBackoff.enabled &&
          isQuotaExhaustionStatus(result.status, this.quotaExhaustionBackoff.statuses)
        ) {
          const delayMs = computeQuotaBackoffMs(this.quotaBackoffAttempt, {
            baseDelayMs: this.quotaExhaustionBackoff.baseDelayMs,
            maxDelayMs: this.quotaExhaustionBackoff.maxDelayMs,
          })
          const pausedUntil = Date.now() + delayMs
          this.pauseReason = 'quota'
          this.pauseGate.pauseFor(delayMs)
          this.quotaBackoffAttempt += 1
          this.callbacks.onQuotaWait?.({
            attempt: this.quotaBackoffAttempt,
            delayMs,
            pausedUntil,
            status: result.status,
          })
          continue
        }

        if (isRetryableServerResponse(result) && transientAttempts < this.maxTransientRetries) {
          const delayMs = computeTransientBackoffMs(transientAttempts, this.transientBackoffOptions)
          transientAttempts += 1
          this.callbacks.onTransientRetry?.({
            attempt: transientAttempts,
            reason: 'server',
            delayMs,
            status: result.status,
          })
          await delay(delayMs)
          continue
        }

        this.syncHeaders(result.headers)
        this.finishHttpRequest(result.status)
        return result
      } catch (error) {
        if (isTransientNetworkError(error) && transientAttempts < this.maxTransientRetries) {
          this.bucket.release()
          const delayMs = computeTransientBackoffMs(transientAttempts, this.transientBackoffOptions)
          transientAttempts += 1
          this.callbacks.onTransientRetry?.({
            attempt: transientAttempts,
            reason: 'network',
            delayMs,
            error,
          })
          await delay(delayMs)
          continue
        }

        throw error
      } finally {
        this.inFlight = false
      }
    }
  }

  private completeRequest(): void {
    const completedAt = Date.now()
    this.totalCompleted += 1
    this.metrics.recordCompletion(completedAt)
    this.callbacks.onRequestComplete?.({ completedAt })
  }

  private finishHttpRequest(status: number): void {
    const completedAt = Date.now()
    this.totalCompleted += 1

    const statusKey = String(status)
    this.httpStatusCounts[statusKey] = (this.httpStatusCounts[statusKey] ?? 0) + 1

    if (status >= 200 && status < 300) {
      this.totalSucceeded += 1
      this.quotaBackoffAttempt = 0
    } else {
      this.totalFailed += 1
    }

    this.metrics.recordCompletion(completedAt)
    this.callbacks.onRequestComplete?.({ completedAt })
  }
}
