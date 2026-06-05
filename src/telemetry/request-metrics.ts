/** Default sparkline: 30 one-second buckets (newest last). */
export const DEFAULT_BUCKET_COUNT = 30
export const DEFAULT_BUCKET_MS = 1_000

const PACE_WINDOW_MS = 60_000

export type RequestMetricsOptions = {
  bucketCount?: number
  bucketMs?: number
}

/**
 * Tracks completed request timestamps for requests-per-minute and
 * rolling frequency buckets (TUI sparkline / equalizer).
 */
export class RequestMetrics {
  private readonly completions: number[] = []
  private readonly bucketCount: number
  private readonly bucketMs: number

  constructor(options: RequestMetricsOptions = {}) {
    this.bucketCount = options.bucketCount ?? DEFAULT_BUCKET_COUNT
    this.bucketMs = options.bucketMs ?? DEFAULT_BUCKET_MS
  }

  recordCompletion(completedAt = Date.now()): void {
    this.completions.push(completedAt)
    this.prune(completedAt)
  }

  getRequestsPerMinute(now = Date.now()): number {
    this.prune(now)
    const cutoff = now - PACE_WINDOW_MS
    return this.completions.filter((timestamp) => timestamp > cutoff).length
  }

  /**
   * Rolling bucket counts for the last `bucketCount * bucketMs` milliseconds.
   * Index 0 is oldest, last index is the current bucket.
   */
  getBucketCounts(now = Date.now()): number[] {
    this.prune(now)
    const windowMs = this.bucketCount * this.bucketMs
    const windowStart = now - windowMs + this.bucketMs
    const counts = Array.from({ length: this.bucketCount }, () => 0)

    for (const timestamp of this.completions) {
      if (timestamp < windowStart) {
        continue
      }
      const index = Math.min(
        this.bucketCount - 1,
        Math.floor((timestamp - windowStart) / this.bucketMs),
      )
      counts[index]! += 1
    }

    return counts
  }

  private prune(now: number): void {
    const cutoff = now - Math.max(PACE_WINDOW_MS, this.bucketCount * this.bucketMs)
    while (this.completions.length > 0 && this.completions[0]! <= cutoff) {
      this.completions.shift()
    }
  }
}
