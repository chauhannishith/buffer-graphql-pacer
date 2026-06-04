import { describe, expect, it, vi } from 'vitest'
import { JobQueue } from '../src/queue/job-queue'

describe('JobQueue', () => {
  it('runs enqueued jobs in fifo order', async () => {
    const queue = new JobQueue()
    const order: number[] = []

    const first = queue.enqueue(async () => {
      order.push(1)
      return 'a'
    })
    const second = queue.enqueue(async () => {
      order.push(2)
      return 'b'
    })

    await Promise.all([first, second])

    expect(order).toEqual([1, 2])
    expect(await first).toBe('a')
    expect(await second).toBe('b')
  })

  it('runs jobs serially so later jobs wait for earlier ones', async () => {
    const queue = new JobQueue()
    let firstFinished = false
    let releaseFirst: (() => void) | undefined

    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.enqueue(async () => {
      await firstGate
      firstFinished = true
      return 1
    })
    const second = queue.enqueue(async () => {
      expect(firstFinished).toBe(true)
      return 2
    })

    await vi.waitFor(() => {
      expect(queue.getDepth()).toBe(1)
    })

    releaseFirst?.()
    await Promise.all([first, second])
  })

  it('reports pending depth excluding the in-flight job', async () => {
    const queue = new JobQueue()
    let resolveGate: (() => void) | undefined

    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })

    void queue.enqueue(async () => {
      await gate
    })
    void queue.enqueue(async () => 'b')

    await vi.waitFor(() => {
      expect(queue.getDepth()).toBe(1)
    })

    resolveGate?.()
    await vi.waitFor(() => {
      expect(queue.getDepth()).toBe(0)
    })
  })

  it('rejects when a job throws and continues draining', async () => {
    const queue = new JobQueue()

    const failing = queue.enqueue(async () => {
      throw new Error('boom')
    })
    const succeeding = queue.enqueue(async () => 'ok')

    await expect(failing).rejects.toThrow('boom')
    expect(await succeeding).toBe('ok')
  })
})
