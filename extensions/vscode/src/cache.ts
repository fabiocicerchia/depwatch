// The cache that makes a scan on every save affordable.
//
// A scan is cheap or ruinous depending on one thing: whether it talks to five
// registries. Everything here exists to make sure it usually does not.
//
//   * A published release is a historical fact. Once fetched, a version list is
//     good for hours — the only thing that can change is a NEW release landing,
//     and being twelve hours late to notice one costs nothing.
//   * Two layers: memory in front of disk. Memory serves the same session,
//     disk serves the next window and survives a reload.
//   * Failures are cached too, briefly. A package that 404s must not be
//     re-requested two hundred times because it appears in two hundred scans.
//   * A stale entry beats no entry. Offline, or rate-limited, the last known
//     answer is served rather than blanking the report.
//   * The memory layer is bounded. A popular package's version list is around
//     130 KB once parsed — react and typescript have shipped ~950 releases each
//     — so an unbounded map would pin tens of megabytes in the extension host
//     for the life of the window. Past the cap the oldest are dropped; the disk
//     copy is still there, and reading one back is a millisecond.
//
// Deliberately free of any `vscode` import so it can be unit-tested without an
// editor; the store below is the only thing that touches the disk.

import { createHash } from 'node:crypto'

/** Where entries are kept. The extension backs this with the disk. */
export interface CacheStore {
  read(id: string): Promise<string | undefined>
  write(id: string, data: string): Promise<void>
  remove(id: string): Promise<void>
  /** Every entry, for pruning. `mtime` is milliseconds since the epoch. */
  entries(): Promise<{ id: string; mtime: number }[]>
}

export interface TtlCacheOptions<T> {
  store: CacheStore
  /** How long an entry stays fresh, in milliseconds. */
  ttlMs: number
  /**
   * Whether a loaded value is a failure. Failures are kept in memory only, for
   * `failureTtlMs`, so a dead package costs one request per scan burst rather
   * than one per dependency, and never poisons the disk cache.
   */
  isFailure?: (value: T) => boolean
  failureTtlMs?: number
  /** How many entries to keep parsed in memory. Beyond this, oldest out. */
  maxInMemory?: number
  /**
   * How many bytes of them to keep. A count cannot bound memory here: a version
   * list runs from a few hundred bytes to a couple of hundred kilobytes, so 200
   * entries is anywhere between 40 KB and 40 MB. This is the cap that holds.
   */
  maxBytesInMemory?: number
  now?: () => number
}

interface Entry<T> {
  savedAt: number
  value: T
}

const DEFAULT_FAILURE_TTL = 10 * 60_000
const DEFAULT_MAX_IN_MEMORY = 200
const DEFAULT_MAX_BYTES_IN_MEMORY = 8 * 1024 * 1024

export class TtlCache<T> {
  private readonly memory = new Map<string, Entry<T>>()
  // Serialised size per held key, and the running total. Free to keep: every
  // entry is already JSON on the way in, either as what was read from disk or
  // as what is about to be written to it.
  private readonly sizes = new Map<string, number>()
  private heldBytes = 0
  // One in-flight load per key: fifty dependencies asking for the same
  // transitive package must produce one request, not fifty.
  private readonly inFlight = new Map<string, Promise<T>>()
  private readonly writes = new WriteQueue()
  private readonly now: () => number

  constructor(private readonly opts: TtlCacheOptions<T>) {
    this.now = opts.now ?? Date.now
  }

  /** Serve `key` from cache, or `load` it and remember the answer. */
  async wrap(key: string, load: () => Promise<T>): Promise<T> {
    const cached = await this.lookup(key)
    if (cached && this.isFresh(cached)) return cached.value

    const running = this.inFlight.get(key)
    if (running) return running

    const task = load()
      .then((value) => {
        // A failed load with a usable stale entry behind it: keep the old
        // answer. Offline should degrade to yesterday's report, not to nothing.
        if (this.failed(value) && cached) return cached.value
        this.remember(key, value)
        return value
      })
      .catch((e: unknown) => {
        if (cached) return cached.value
        throw e
      })
      .finally(() => this.inFlight.delete(key))

    this.inFlight.set(key, task)
    return task
  }

  private isFresh(entry: Entry<T>): boolean {
    const ttl = this.failed(entry.value) ? (this.opts.failureTtlMs ?? DEFAULT_FAILURE_TTL) : this.opts.ttlMs
    return this.now() - entry.savedAt < ttl
  }

  private failed(value: T): boolean {
    return this.opts.isFailure?.(value) ?? false
  }

  private async lookup(key: string): Promise<Entry<T> | undefined> {
    const hot = this.memory.get(key)
    if (hot) {
      this.hold(key, hot) // touch: least-recently-used is what gets dropped
      return hot
    }
    const raw = await this.opts.store.read(id(key))
    if (raw === undefined) return undefined
    try {
      const entry = JSON.parse(raw) as Entry<T>
      if (typeof entry?.savedAt !== 'number') return undefined
      this.hold(key, entry, raw.length)
      return entry
    } catch {
      return undefined // a truncated file is a cache miss, not an error
    }
  }

  /** Insert or touch, and evict the least recently used once over either cap. */
  private hold(key: string, entry: Entry<T>, bytes = this.sizes.get(key) ?? 0): void {
    this.drop(key)
    this.memory.set(key, entry)
    this.sizes.set(key, bytes)
    this.heldBytes += bytes

    const entryCap = this.opts.maxInMemory ?? DEFAULT_MAX_IN_MEMORY
    const byteCap = this.opts.maxBytesInMemory ?? DEFAULT_MAX_BYTES_IN_MEMORY
    // Never down to nothing: an entry big enough to breach the cap on its own is
    // still the one just asked for, and evicting it would make the cache a
    // no-op for exactly the packages it costs most to refetch.
    while (this.memory.size > entryCap || (this.heldBytes > byteCap && this.memory.size > 1)) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.drop(oldest)
    }
  }

  private drop(key: string): void {
    if (!this.memory.delete(key)) return
    this.heldBytes -= this.sizes.get(key) ?? 0
    this.sizes.delete(key)
  }

  /** How many entries are parsed in memory right now. */
  get held(): number {
    return this.memory.size
  }

  /** How many bytes of them, by the size they serialise to. */
  get heldSize(): number {
    return this.heldBytes
  }

  private remember(key: string, value: T): void {
    const entry: Entry<T> = { savedAt: this.now(), value }
    // Serialised here rather than inside the queued write: the size is what the
    // memory cap is measured in, and doing it eagerly also stops the queue
    // holding the whole parsed value alive until it drains.
    const json = JSON.stringify(entry)
    this.hold(key, entry, json.length)
    // Failures stay in memory: they expire in minutes and are not worth a write.
    if (!this.failed(value)) this.writes.push(() => this.opts.store.write(id(key), json))
  }

  /** Wait for queued disk writes — for tests and for shutdown. */
  flush(): Promise<void> {
    return this.writes.drained()
  }

  async clear(): Promise<void> {
    this.forgetMemory()
    for (const { id: entryId } of await this.opts.store.entries()) await this.opts.store.remove(entryId)
  }

  private forgetMemory(): void {
    this.memory.clear()
    this.sizes.clear()
    this.heldBytes = 0
  }

  /**
   * Drop what is no longer worth keeping: entries far past their TTL, then the
   * oldest of whatever is left once the cache is over its cap. Cheap enough to
   * run once at startup and never think about again.
   */
  async prune(maxEntries: number): Promise<number> {
    const entries = await this.opts.store.entries()
    // Twice the TTL: a stale entry still has value as an offline fallback, so
    // it is only worth deleting once it is well past useful.
    const deadline = this.now() - this.opts.ttlMs * 2
    const doomed = entries.filter((e) => e.mtime < deadline)
    const survivors = entries.filter((e) => e.mtime >= deadline).sort((a, b) => b.mtime - a.mtime)
    doomed.push(...survivors.slice(maxEntries))

    for (const entry of doomed) await this.opts.store.remove(entry.id)
    if (doomed.length > 0) this.forgetMemory()
    return doomed.length
  }
}

// Keys carry package names, which carry slashes, scopes and case that no
// filesystem agrees about. A hash sidesteps all of it.
function id(key: string): string {
  return createHash('sha1').update(key).digest('hex')
}

/**
 * Disk writes, one at a time. Two hundred packages resolved in parallel would
 * otherwise be two hundred simultaneous writes — exactly the kind of disk
 * traffic an editor extension has no business generating.
 */
class WriteQueue {
  private readonly pending: (() => Promise<void>)[] = []
  private running: Promise<void> | null = null

  push(task: () => Promise<void>): void {
    this.pending.push(task)
    this.running ??= this.drain()
  }

  drained(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  private async drain(): Promise<void> {
    for (;;) {
      const task = this.pending.shift()
      if (!task) break
      try {
        await task()
      } catch {
        // A cache write that fails is a slower next scan, nothing more.
      }
    }
    this.running = null
  }
}
