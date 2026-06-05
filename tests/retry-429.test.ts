import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRetryAfterSeconds, PauseGate } from '../src/backoff/retry-429'

describe('PauseGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks wait until pause duration elapses', async () => {
    const gate = new PauseGate()
    gate.pauseFor(5_000)

    const waitPromise = gate.wait()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(gate.getPausedUntil()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await waitPromise
    expect(gate.getPausedUntil()).toBeNull()
  })

  it('extends pause when a longer duration is requested', () => {
    const gate = new PauseGate()
    gate.pauseFor(1_000)
    gate.pauseFor(5_000)

    expect(gate.getPausedUntil()).toBe(Date.now() + 5_000)
  })

  it('unblocks wait immediately when aborted', async () => {
    const gate = new PauseGate()
    gate.pauseFor(60_000)

    const waitPromise = gate.wait()
    gate.abort()
    await waitPromise

    expect(gate.getPausedUntil()).toBeNull()
  })
})

describe('parseRetryAfterSeconds', () => {
  it('reads retryAfter from a JSON body', async () => {
    const response = new Response(JSON.stringify({ retryAfter: 12 }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(await parseRetryAfterSeconds(response)).toBe(12)
  })

  it('falls back to the Retry-After header', async () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '30' },
    })

    expect(await parseRetryAfterSeconds(response)).toBe(30)
  })

  it('returns null for non-429 responses', async () => {
    const response = new Response(null, { status: 200 })
    expect(await parseRetryAfterSeconds(response)).toBeNull()
  })
})
