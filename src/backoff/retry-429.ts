const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Global pause gate used when Buffer returns HTTP 429.
 */
export class PauseGate {
  private pausedUntilMs = 0

  pauseFor(durationMs: number, now = Date.now()): void {
    if (durationMs <= 0) {
      return
    }
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + durationMs)
  }

  getPausedUntil(now = Date.now()): number | null {
    return this.pausedUntilMs > now ? this.pausedUntilMs : null
  }

  async wait(now = Date.now()): Promise<void> {
    const remainingMs = this.pausedUntilMs - now
    if (remainingMs > 0) {
      await delay(remainingMs)
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
