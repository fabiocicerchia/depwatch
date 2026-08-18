import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Burst, Coalescer, Debouncer, Heartbeat } from './schedule.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Debouncer', () => {
  it('runs once for a burst of saves', () => {
    const run = vi.fn()
    const d = new Debouncer(1500)
    for (let i = 0; i < 5; i++) d.schedule('package.json', run)

    vi.advanceTimersByTime(1499)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps different files apart', () => {
    const a = vi.fn()
    const b = vi.fn()
    const d = new Debouncer(100)
    d.schedule('a', a)
    d.schedule('b', b)
    vi.advanceTimersByTime(100)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('runs synchronously when the delay is zero', () => {
    const run = vi.fn()
    new Debouncer(0).schedule('a', run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops pending work when disposed', () => {
    const run = vi.fn()
    const d = new Debouncer(100)
    d.schedule('a', run)
    d.dispose()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('Heartbeat', () => {
  it('does not start at all when the interval is zero', () => {
    const run = vi.fn()
    const h = new Heartbeat({ intervalMs: 0, isFocused: () => true, run })
    h.start()
    vi.advanceTimersByTime(60 * 60_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('fires on its interval while the window has focus', () => {
    const run = vi.fn()
    const h = new Heartbeat({ intervalMs: 1000, isFocused: () => true, run })
    h.start()
    vi.advanceTimersByTime(3000)
    expect(run).toHaveBeenCalledTimes(3)
    h.dispose()
  })

  // A laptop in a bag has nothing to re-check, and a queue of missed ticks
  // must not all land at once when it wakes up.
  it('defers a tick that arrives unfocused, and runs it once on return', () => {
    const run = vi.fn()
    let focused = false
    const h = new Heartbeat({ intervalMs: 1000, isFocused: () => focused, run })
    h.start()

    vi.advanceTimersByTime(5000)
    expect(run).not.toHaveBeenCalled()

    focused = true
    h.resumed()
    expect(run).toHaveBeenCalledTimes(1)

    // Nothing outstanding now, so regaining focus again is not a scan.
    h.resumed()
    expect(run).toHaveBeenCalledTimes(1)
    h.dispose()
  })

  it('restarts on a new interval', () => {
    const run = vi.fn()
    const h = new Heartbeat({ intervalMs: 1000, isFocused: () => true, run })
    h.start()
    h.setIntervalMs(5000)
    vi.advanceTimersByTime(4999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    h.dispose()
  })
})

describe('Coalescer', () => {
  it('joins a second request to the one already running', async () => {
    vi.useRealTimers()
    const c = new Coalescer<string>()
    let calls = 0
    const task = () => {
      calls++
      return new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10))
    }

    const [a, b] = await Promise.all([c.run('key', task), c.run('key', task)])
    expect([a, b]).toEqual(['done', 'done'])
    expect(calls).toBe(1)
  })

  it('lets the next request start once the first finished', async () => {
    vi.useRealTimers()
    const c = new Coalescer<number>()
    let calls = 0
    const task = async () => ++calls

    expect(await c.run('k', task)).toBe(1)
    expect(await c.run('k', task)).toBe(2)
  })

  // A failed scan must not wedge the key: the next save has to be able to run.
  it('releases the key when the task rejects', async () => {
    vi.useRealTimers()
    const c = new Coalescer<number>()
    await expect(c.run('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await c.run('k', async () => 1)).toBe(1)
  })
})

describe('Burst', () => {
  it('fires at once, then folds the rest of the window into one more', () => {
    const emit = vi.fn()
    const b = new Burst(150, emit)

    b.hit()
    expect(emit).toHaveBeenCalledTimes(1) // leading: a single change is immediate

    for (let i = 0; i < 24; i++) b.hit() // a workspace scan finishing manifest by manifest
    expect(emit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(150)
    expect(emit).toHaveBeenCalledTimes(2) // trailing: 25 changes, 2 updates
    b.dispose()
  })

  it('does not fire a trailing edge when nothing else arrived', () => {
    const emit = vi.fn()
    const b = new Burst(150, emit)
    b.hit()
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1)
    b.dispose()
  })

  it('is immediate again once the window has passed', () => {
    const emit = vi.fn()
    const b = new Burst(150, emit)
    b.hit()
    vi.advanceTimersByTime(200)
    b.hit()
    expect(emit).toHaveBeenCalledTimes(2)
    b.dispose()
  })

  it('drops a pending trailing edge when disposed', () => {
    const emit = vi.fn()
    const b = new Burst(150, emit)
    b.hit()
    b.hit()
    b.dispose()
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
