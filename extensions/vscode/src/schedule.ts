// When a scan is allowed to happen.
//
// The policy, in one place, because "why is my fan on" is the question this
// extension most has to avoid:
//
//   * never while typing — saves only, and even then debounced, so holding
//     ctrl-S costs one scan;
//   * the periodic re-check exists only to notice releases published
//     elsewhere, so it is measured in hours and skipped entirely while the
//     window is in the background — a laptop in a bag has nothing to re-check;
//   * a scan already running is joined, never duplicated.
//
// No `vscode` import: focus is a callback, so this is testable with a fake
// clock.

export class Debouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly delayMs: number) {}

  schedule(key: string, run: () => void): void {
    this.cancel(key)
    if (this.delayMs <= 0) {
      run()
      return
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        run()
      }, this.delayMs),
    )
  }

  cancel(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

export interface HeartbeatOptions {
  intervalMs: number
  isFocused: () => boolean
  run: () => void
}

/**
 * The slow re-check. It fires on its interval, but only while the window has
 * focus: a tick that arrives in the background is remembered and runs the
 * moment the window comes back, so a machine that was asleep does not wake up
 * to a queue of scans.
 */
export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null
  private due = false
  private intervalMs: number

  constructor(private readonly opts: HeartbeatOptions) {
    this.intervalMs = opts.intervalMs
  }

  /** Change the interval — the setting is live, like every other one here. */
  setIntervalMs(ms: number): void {
    if (ms === this.intervalMs) return
    this.intervalMs = ms
    this.start()
  }

  start(): void {
    this.stop()
    if (this.intervalMs <= 0) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    // Node keeps the process alive for pending timers; an editor extension has
    // no business doing that.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Call when the window regains focus. */
  resumed(): void {
    if (!this.due) return
    this.due = false
    this.opts.run()
  }

  dispose(): void {
    this.stop()
  }

  private tick(): void {
    if (!this.opts.isFocused()) {
      this.due = true
      return
    }
    this.opts.run()
  }
}

/**
 * One run per key at a time. A save that lands while a scan of the same
 * manifest is in flight joins it rather than starting a second one.
 */
export class Coalescer<T> {
  private readonly running = new Map<string, Promise<T>>()

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.running.get(key)
    if (existing) return existing
    const started = task().finally(() => this.running.delete(key))
    this.running.set(key, started)
    return started
  }

  isRunning(key: string): boolean {
    return this.running.has(key)
  }
}
