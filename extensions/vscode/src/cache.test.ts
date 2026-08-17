import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CacheStore, TtlCache } from './cache.js'

// An in-memory store standing in for the disk, so the cache's own logic is what
// is under test rather than the filesystem's.
class MemoryStore implements CacheStore {
  readonly files = new Map<string, { data: string; mtime: number }>()
  reads = 0
  writes = 0
  clock = () => 0

  async read(id: string): Promise<string | undefined> {
    this.reads++
    return this.files.get(id)?.data
  }

  async write(id: string, data: string): Promise<void> {
    this.writes++
    this.files.set(id, { data, mtime: this.clock() })
  }

  async remove(id: string): Promise<void> {
    this.files.delete(id)
  }

  async entries(): Promise<{ id: string; mtime: number }[]> {
    return [...this.files].map(([id, f]) => ({ id, mtime: f.mtime }))
  }
}

const HOUR = 3_600_000

describe('TtlCache', () => {
  let now = 0
  let store: MemoryStore

  beforeEach(() => {
    now = 1_000_000
    store = new MemoryStore()
    store.clock = () => now
  })

  const cache = <T,>(over: Partial<ConstructorParameters<typeof TtlCache<T>>[0]> = {}) =>
    new TtlCache<T>({ store, ttlMs: 12 * HOUR, now: () => now, ...over })

  it('loads once and serves the rest from memory', async () => {
    const c = cache<string>()
    const load = vi.fn(async () => 'versions')

    expect(await c.wrap('npm:react', load)).toBe('versions')
    expect(await c.wrap('npm:react', load)).toBe('versions')
    expect(load).toHaveBeenCalledTimes(1)
  })

  // The point of the disk half: the next window starts warm.
  it('serves a new cache from what the last one wrote', async () => {
    const first = cache<string>()
    await first.wrap('npm:react', async () => 'versions')
    await first.flush()
    expect(store.writes).toBe(1)

    const load = vi.fn(async () => 'refetched')
    expect(await cache<string>().wrap('npm:react', load)).toBe('versions')
    expect(load).not.toHaveBeenCalled()
  })

  it('refetches once the entry is past its TTL', async () => {
    const c = cache<string>()
    await c.wrap('npm:react', async () => 'old')
    now += 13 * HOUR
    expect(await c.wrap('npm:react', async () => 'new')).toBe('new')
  })

  // Fifty dependencies resolving the same transitive package must produce one
  // request, not fifty.
  it('collapses concurrent loads of the same key', async () => {
    const c = cache<string>()
    const load = vi.fn(async () => 'versions')
    const all = await Promise.all([c.wrap('k', load), c.wrap('k', load), c.wrap('k', load)])
    expect(all).toEqual(['versions', 'versions', 'versions'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  describe('failures', () => {
    const isFailure = (v: { error?: string }) => 'error' in v && v.error !== undefined

    it('keeps them out of the disk cache but remembers them briefly', async () => {
      const c = cache<{ error?: string }>({ isFailure, failureTtlMs: 10 * 60_000 })
      const load = vi.fn(async () => ({ error: 'not found in registry' }))

      await c.wrap('npm:ghost', load)
      await c.wrap('npm:ghost', load)
      await c.flush()

      expect(load).toHaveBeenCalledTimes(1) // not re-requested per dependency
      expect(store.writes).toBe(0) // and not written to disk

      now += 11 * 60_000
      await c.wrap('npm:ghost', load)
      expect(load).toHaveBeenCalledTimes(2) // but retried before long
    })

    // Offline should degrade to yesterday's report, not to a blank one.
    it('serves a stale entry when a refetch fails', async () => {
      const c = cache<{ versions?: string; error?: string }>({ isFailure })
      await c.wrap('npm:react', async () => ({ versions: 'good' }))
      now += 13 * HOUR
      expect(await c.wrap('npm:react', async () => ({ error: 'offline' }))).toEqual({ versions: 'good' })
    })

    it('serves a stale entry when the loader throws', async () => {
      const c = cache<string>()
      await c.wrap('k', async () => 'good')
      now += 13 * HOUR
      expect(
        await c.wrap('k', async () => {
          throw new Error('network down')
        }),
      ).toBe('good')
    })

    it('rethrows when there is nothing stale to fall back to', async () => {
      await expect(
        cache<string>().wrap('k', async () => {
          throw new Error('network down')
        }),
      ).rejects.toThrow('network down')
    })
  })

  describe('prune', () => {
    it('drops entries well past their TTL and caps what is left', async () => {
      const c = cache<string>()
      for (const key of ['a', 'b', 'c']) {
        await c.wrap(key, async () => key)
        now += 1000 // distinct mtimes, newest last
      }
      await c.flush()
      expect(store.files.size).toBe(3)

      // Nothing is ancient yet, so only the cap applies: the two newest live.
      expect(await c.prune(2)).toBe(1)
      expect(store.files.size).toBe(2)

      // Past twice the TTL, an entry is not even worth keeping as a fallback.
      now += 25 * HOUR
      expect(await c.prune(100)).toBe(2)
      expect(store.files.size).toBe(0)
    })
  })

  it('clears everything on request', async () => {
    const c = cache<string>()
    await c.wrap('a', async () => 'a')
    await c.flush()
    await c.clear()
    expect(store.files.size).toBe(0)

    const load = vi.fn(async () => 'fresh')
    expect(await c.wrap('a', load)).toBe('fresh')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('treats a corrupted entry as a miss', async () => {
    const c = cache<string>()
    await c.wrap('a', async () => 'a')
    await c.flush()
    const [id] = [...store.files.keys()]
    store.files.set(id, { data: '{"savedAt":', mtime: now })

    expect(await cache<string>().wrap('a', async () => 'reloaded')).toBe('reloaded')
  })

  // A busy package's version list is ~130 KB parsed, so an unbounded memory map
  // would pin tens of megabytes in the extension host for the life of a window.
  describe('memory cap', () => {
    it('keeps only the most recently used, and re-reads the rest from disk', async () => {
      const c = cache<string>({ maxInMemory: 2 })
      for (const key of ['a', 'b', 'c']) await c.wrap(key, async () => key)
      await c.flush()

      expect(c.held).toBe(2)
      expect(store.files.size).toBe(3) // evicted from memory, still on disk

      const load = vi.fn(async () => 'refetched')
      expect(await c.wrap('a', load)).toBe('a') // served from disk, not the network
      expect(load).not.toHaveBeenCalled()
    })

    it('drops the least recently used, not the oldest written', async () => {
      const c = cache<string>({ maxInMemory: 2 })
      await c.wrap('a', async () => 'a')
      await c.wrap('b', async () => 'b')
      await c.wrap('a', async () => 'a') // touching 'a' makes 'b' the coldest
      await c.wrap('c', async () => 'c')
      await c.flush()

      // 'b' left memory; a lookup for it has to go to the store, 'a' does not.
      const reads = store.reads
      await c.wrap('a', async () => 'a')
      expect(store.reads).toBe(reads)
      await c.wrap('b', async () => 'b')
      expect(store.reads).toBe(reads + 1)
    })
  })
})
