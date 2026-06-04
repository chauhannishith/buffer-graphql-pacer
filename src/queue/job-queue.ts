type QueuedJob<T> = {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

/**
 * In-memory FIFO queue that drains jobs serially (one in flight at a time).
 */
export class JobQueue {
  private readonly pending: QueuedJob<unknown>[] = []
  private draining = false

  /** Number of jobs waiting to run (excludes the in-flight job). */
  getDepth(): number {
    return this.pending.length
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return
    }
    this.draining = true

    while (this.pending.length > 0) {
      const job = this.pending.shift() as QueuedJob<unknown>
      try {
        const result = await job.run()
        job.resolve(result)
      } catch (error) {
        job.reject(error)
      }
    }

    this.draining = false
  }
}
