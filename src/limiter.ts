import { parseRetryAfterSeconds, PauseGate } from './backoff/retry-429'
import {
  computeFailureBackoffMs,
  FAILURE_BACKOFF_DEFAULTS,
  parseGraphqlErrorCode,
  responseHasGraphqlErrors,
  shouldFailureBackoff,
  type FailureBackoffOptions,
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

export type PauseReason = 'rate_limit' | 'failure' | null

/** Thrown when later jobs are skipped after an earlier scheduled request failed. */
export class BatchHaltedError extends Error {
  readonly name = 'BatchHaltedError'

  constructor(message = 'Batch halted after an earlier request failed') {
    super(message)
  }
}

/** Thrown when {@link BufferRateLimiter.abort} or SIGINT/q stops a run. */
export class LimiterAbortedError extends Error {
  readonly name = 'LimiterAbortedError'

  constructor(message = 'Rate limiter run aborted') {
    super(message)
  }
}

/** Thrown when failure backoff exhausts {@link FailureBackoffOptions.maxFailureAttempts}. */
export class FailureBackoffExhaustedError extends Error {
  readonly name = 'FailureBackoffExhaustedError'

  constructor(
    readonly attempts: number,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Failure backoff exhausted after ${attempts} attempts (HTTP ${status})`)
  }
}

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
  onFailureWait?: (info: {
    attempt: number
    delayMs: number
    pausedUntil: number
    status: number
    graphql?: boolean
  }) => void
  /** @deprecated Use {@link BufferRateLimiterCallbacks.onFailureWait}. */
  onQuotaWait?: (info: {
    attempt: number
    delayMs: number
    pausedUntil: number
    status: number
    graphql?: boolean
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
  /** Pause and retry on client failures (default: any 4xx except 429, GraphQL errors, exhausted 5xx). */
  failureBackoff?: FailureBackoffOptions
  /** @deprecated Use {@link BufferRateLimiterOptions.failureBackoff}. */
  quotaExhaustionBackoff?: FailureBackoffOptions
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
  /** Status code from the most recent HTTP response (including retries). */
  lastHttpStatus: number | null
  /** Buffer GraphQL `errors[0].extensions.code` when present (often on HTTP 200). */
  lastGraphqlErrorCode: string | null
  pauseReason: PauseReason
  /** True after the first non-retryable failure; remaining jobs are skipped. */
  batchHalted: boolean
  inFlight: boolean
  requestsPerMinute: number
  pacingStatus: PacingStatus
  /** Rolling per-second buckets for terminal sparklines (oldest first). */
  requestBuckets: number[]
}

type ResolvedFailureBackoff = Required<
  Pick<
    FailureBackoffOptions,
    | 'enabled'
    | 'excludeStatuses'
    | 'includeGraphqlErrors'
    | 'includeServerErrors'
    | 'haltBatchOnFirstFailure'
    | 'baseDelayMs'
    | 'maxDelayMs'
  >
> & {
  statuses?: number[]
  maxFailureAttempts?: number
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
  private readonly failureBackoff: ResolvedFailureBackoff

  private totalScheduled = 0
  private totalCompleted = 0
  private totalSucceeded = 0
  private totalFailed = 0
  private readonly httpStatusCounts: Record<string, number> = {}
  private lastHttpStatus: number | null = null
  private lastGraphqlErrorCode: string | null = null
  private failureBackoffAttempt = 0
  private batchHalted = false
  private aborted = false
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
    const failureOptions = options.failureBackoff ?? options.quotaExhaustionBackoff ?? {}
    this.failureBackoff = {
      enabled: failureOptions.enabled ?? true,
      excludeStatuses: failureOptions.excludeStatuses ?? [
        ...FAILURE_BACKOFF_DEFAULTS.excludeStatuses,
      ],
      includeGraphqlErrors:
        failureOptions.includeGraphqlErrors ?? FAILURE_BACKOFF_DEFAULTS.includeGraphqlErrors,
      includeServerErrors:
        failureOptions.includeServerErrors ?? FAILURE_BACKOFF_DEFAULTS.includeServerErrors,
      haltBatchOnFirstFailure: failureOptions.haltBatchOnFirstFailure ?? true,
      baseDelayMs: failureOptions.baseDelayMs ?? FAILURE_BACKOFF_DEFAULTS.baseDelayMs,
      maxDelayMs: failureOptions.maxDelayMs ?? FAILURE_BACKOFF_DEFAULTS.maxDelayMs,
      ...(failureOptions.statuses !== undefined ? { statuses: failureOptions.statuses } : {}),
      ...(failureOptions.maxFailureAttempts !== undefined
        ? { maxFailureAttempts: failureOptions.maxFailureAttempts }
        : {}),
    }
    const rawCallbacks = options.callbacks ?? {}
    const onFailureWait = rawCallbacks.onFailureWait ?? rawCallbacks.onQuotaWait
    this.callbacks = {
      ...rawCallbacks,
      ...(onFailureWait !== undefined ? { onFailureWait } : {}),
    }
  }

  /**
   * Enqueue work that will run after a token is available.
   * Jobs run one at a time in FIFO order.
   *
   * When the scheduled function returns a `Response`, the limiter:
   * - syncs pacing from `RateLimit-*` headers on success
   * - pauses and retries after HTTP 429 using `retryAfter`
   * - pauses with exponential backoff (up to 24h) on hard failures (4xx except 429, GraphQL errors, 5xx)
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

  /** Stop in-flight and pending work (SIGINT, dashboard q, manual cancel). */
  abort(): void {
    this.aborted = true
    this.batchHalted = true
    this.pauseGate.abort()
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
      lastHttpStatus: this.lastHttpStatus,
      lastGraphqlErrorCode: this.lastGraphqlErrorCode,
      pauseReason: this.pauseReason,
      batchHalted: this.batchHalted,
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
      this.throwIfAborted()
      if (this.batchHalted) {
        throw new BatchHaltedError()
      }

      const wasPaused = this.pauseGate.getPausedUntil() !== null
      await this.pauseGate.wait()
      if (wasPaused) {
        this.pauseReason = null
        this.callbacks.onResume?.()
      }

      const headerDelay = this.headerTracker.getRecommendedDelayMs()
      if (headerDelay > 0) {
        await this.interruptibleDelay(headerDelay)
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

        this.lastHttpStatus = result.status
        this.lastGraphqlErrorCode = await parseGraphqlErrorCode(result)

        if (result.status === 429) {
          const retryAfterSeconds =
            (await parseRetryAfterSeconds(result)) ?? this.defaultRetryAfterSeconds
          const pausedUntil = Date.now() + retryAfterSeconds * 1000
          this.pauseReason = 'rate_limit'
          this.pauseGate.pauseFor(retryAfterSeconds * 1000)
          this.callbacks.onPause?.({ pausedUntil, retryAfterSeconds })
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
          await this.interruptibleDelay(delayMs)
          continue
        }

        if (this.failureBackoff.enabled && (await this.shouldBackoffForResponse(result))) {
          if (this.isFailureAttemptsExhausted()) {
            this.markBatchHalted()
            throw new FailureBackoffExhaustedError(this.failureBackoffAttempt, result.status)
          }
          await this.pauseForFailure(result.status, {
            graphql: result.status >= 200 && result.status < 300,
          })
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
          await this.interruptibleDelay(delayMs)
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
      this.failureBackoffAttempt = 0
    } else {
      this.totalFailed += 1
      this.markBatchHalted()
    }

    this.metrics.recordCompletion(completedAt)
    this.callbacks.onRequestComplete?.({ completedAt })
  }

  private async shouldBackoffForResponse(response: Response): Promise<boolean> {
    if (shouldFailureBackoff(response.status, this.failureBackoff)) {
      return true
    }

    if (
      response.status >= 200 &&
      response.status < 300 &&
      this.failureBackoff.includeGraphqlErrors
    ) {
      return responseHasGraphqlErrors(response)
    }

    return false
  }

  private async pauseForFailure(status: number, info: { graphql?: boolean }): Promise<void> {
    const delayMs = computeFailureBackoffMs(this.failureBackoffAttempt, {
      baseDelayMs: this.failureBackoff.baseDelayMs,
      maxDelayMs: this.failureBackoff.maxDelayMs,
    })
    const pausedUntil = Date.now() + delayMs
    this.pauseReason = 'failure'
    this.pauseGate.pauseFor(delayMs)
    this.failureBackoffAttempt += 1
    this.callbacks.onFailureWait?.({
      attempt: this.failureBackoffAttempt,
      delayMs,
      pausedUntil,
      status,
      ...(info.graphql !== undefined ? { graphql: info.graphql } : {}),
    })
  }

  private markBatchHalted(): void {
    if (this.failureBackoff.haltBatchOnFirstFailure) {
      this.batchHalted = true
    }
  }

  private throwIfAborted(): void {
    if (this.aborted) {
      throw new LimiterAbortedError()
    }
  }

  private isFailureAttemptsExhausted(): boolean {
    return (
      this.failureBackoff.maxFailureAttempts !== undefined &&
      this.failureBackoffAttempt >= this.failureBackoff.maxFailureAttempts
    )
  }

  private async interruptibleDelay(ms: number): Promise<void> {
    const stepMs = 250
    let remainingMs = ms
    while (remainingMs > 0) {
      this.throwIfAborted()
      await delay(Math.min(remainingMs, stepMs))
      remainingMs -= stepMs
    }
  }
}
