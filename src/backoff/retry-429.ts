/**
 * Global pause gate used when Buffer returns HTTP 429.
 */
export class PauseGate {
  private pausedUntilMs = 0
  private aborted = false
  private wakeWaiters: Array<() => void> = []

  pauseFor(durationMs: number, now = Date.now()): void {
    if (durationMs <= 0) {
      return
    }
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + durationMs)
  }

  /** Unblock {@link wait} immediately (e.g. user abort). */
  abort(): void {
    this.aborted = true
    this.pausedUntilMs = 0
    this.flushWaiters()
  }

  private flushWaiters(): void {
    const waiters = this.wakeWaiters
    this.wakeWaiters = []
    for (const wake of waiters) {
      wake()
    }
  }

  getPausedUntil(now = Date.now()): number | null {
    return this.pausedUntilMs > now ? this.pausedUntilMs : null
  }

  async wait(now = Date.now()): Promise<void> {
    const pollMs = 250
    while (true) {
      if (this.aborted) {
        return
      }
      const remainingMs = this.pausedUntilMs - now
      if (remainingMs <= 0) {
        return
      }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, Math.min(remainingMs, pollMs))
        this.wakeWaiters.push(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
      now = Date.now()
    }
  }
}

/**
 * Read Buffer's retryAfter value (seconds) from a 429 response.
 * Clones the response before reading JSON so callers can still inspect headers.
 */
export async function parseRetryAfterSeconds(response: Response): Promise<number | null> {
  if (response.status !== 429) {
    return null
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  if (contentType.includes('json')) {
    try {
      const clone = response.clone()
      const body = (await clone.json()) as { retryAfter?: unknown }
      if (typeof body.retryAfter === 'number' && body.retryAfter >= 0) {
        return body.retryAfter
      }
    } catch {
      // fall through to Retry-After header
    }
  }

  const retryAfterHeader = response.headers.get('Retry-After')
  if (retryAfterHeader !== null) {
    const seconds = Number.parseInt(retryAfterHeader, 10)
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds
    }
  }

  return null
}
