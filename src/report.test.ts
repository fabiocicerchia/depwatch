import { describe, expect, it } from 'vitest'
import type { PackageInfo, RegistryError } from '@lib/registry-client'
import { analyse, type AnalyseCache, quadrant } from './report.js'
import type { Manifest } from './manifest.js'

const manifest = (deps: Manifest['deps']): Manifest => ({ ecosystem: 'npm', file: 'package.json', deps })

// Every version list these tests use is canned, and the cache below never calls
// its loader — so nothing here touches the network.
function cannedCache(
  responses: Record<string, PackageInfo | RegistryError>,
): { cache: AnalyseCache; loads: string[] } {
  const loads: string[] = []
  return {
    loads,
    cache: {
      packages: async (key, load) => {
        const hit = responses[key]
        if (hit) return hit
        loads.push(key)
        return load()
      },
    },
  }
}

const pkg = (name: string, versions: [string, string][]): PackageInfo => ({
  name,
  ecosystem: 'npm',
  versions: versions.map(([version, released]) => ({ version, released })),
})

describe('quadrant', () => {
  const t = { staleLibyears: 1, riskyViability: 0.5 }
  it('separates the four cases', () => {
    expect(quadrant(0.2, 0.9, t)).toBe('healthy')
    expect(quadrant(3, 0.9, t)).toBe('upgrade')
    expect(quadrant(0.2, 0.1, t)).toBe('watch')
    expect(quadrant(3, 0.1, t)).toBe('replace')
  })
})

describe('analyse', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')

  it('scores drift and viability from the injected cache without fetching', async () => {
    const { cache, loads } = cannedCache({
      'npm:left-pad': pkg('left-pad', [
        ['1.0.0', '2020-01-01T00:00:00Z'],
        ['2.0.0', '2025-01-01T00:00:00Z'],
      ]),
    })
    const r = await analyse(manifest([{ name: 'left-pad', current: '1.0.0', resolved: true }]), { now, cache })

    expect(loads).toEqual([]) // nothing reached a registry
    expect(r.deps[0].latest).toBe('2.0.0')
    expect(r.deps[0].libyearsBehind).toBeCloseTo(5, 1)
    expect(r.totalLibyears).toBeCloseTo(5, 1)
    // A year without a release: alive, but no longer brisk.
    expect(r.deps[0].signals.lastReleaseAgeDays).toBeCloseTo(365, 0)
    expect(r.deps[0].quadrant).toBe('upgrade')
  })

  // The cache is keyed by ecosystem and lower-cased name, so the same package
  // requested twice — under either spelling — is one lookup.
  it('asks the cache once per package', async () => {
    const seen: string[] = []
    const cache: AnalyseCache = {
      packages: async (key) => {
        seen.push(key)
        return pkg('a', [['1.0.0', '2025-01-01T00:00:00Z']])
      },
    }
    await analyse(
      manifest([
        { name: 'A', current: '1.0.0', resolved: true },
        { name: 'a', current: '1.0.0', resolved: true },
      ]),
      { now, cache },
    )
    expect(seen).toEqual(['npm:a', 'npm:a']) // one key, so a real cache serves the second
  })

  // Unknown is not dead: a package the registry would not answer for keeps a
  // neutral score and says why, rather than being plotted as abandoned.
  it('degrades a dep the registry could not answer for', async () => {
    const { cache } = cannedCache({ 'npm:ghost': { error: 'not found in registry' } })
    const r = await analyse(manifest([{ name: 'ghost', current: '1.0.0', resolved: true }]), { now, cache })

    expect(r.deps[0].degraded).toBe('not found in registry')
    expect(r.deps[0].viability).toBe(0.5)
    expect(r.deps[0].libyearsBehind).toBe(0)
    expect(r.totalLibyears).toBe(0)
  })

  // Release dates are historical facts, so an older `asOf` is answerable from
  // today's version list — this is what trend mode rides on.
  it('hides releases published after asOf', async () => {
    const { cache } = cannedCache({
      'npm:a': pkg('a', [
        ['1.0.0', '2020-01-01T00:00:00Z'],
        ['2.0.0', '2025-01-01T00:00:00Z'],
      ]),
    })
    const r = await analyse(manifest([{ name: 'a', current: '1.0.0', resolved: true }]), {
      now,
      asOf: Date.parse('2023-01-01T00:00:00Z'),
      cache,
    })
    expect(r.deps[0].latest).toBe('1.0.0')
    expect(r.deps[0].libyearsBehind).toBe(0)
  })
})

describe('progress', () => {
  it('reports each dependency as it is scored, with a running count', async () => {
    const { cache } = cannedCache({
      'npm:a': pkg('a', [['1.0.0', '2025-01-01T00:00:00Z']]),
      'npm:b': pkg('b', [['1.0.0', '2025-01-01T00:00:00Z']]),
      'npm:c': pkg('c', [['1.0.0', '2025-01-01T00:00:00Z']]),
    })
    const seen: string[] = []
    await analyse(
      manifest([
        { name: 'a', current: '1.0.0', resolved: true },
        { name: 'b', current: '1.0.0', resolved: true },
        { name: 'c', current: '1.0.0', resolved: true },
      ]),
      {
        now: Date.parse('2026-01-01T00:00:00Z'),
        cache,
        onDep: (dep, done, total) => seen.push(`${dep.name} ${done}/${total}`),
      },
    )
    expect(seen).toHaveLength(3)
    expect(seen.map((s) => s.split(' ')[1])).toEqual(['1/3', '2/3', '3/3'])
  })
})

describe('cancellation', () => {
  it('stops taking new work once the signal aborts', async () => {
    const controller = new AbortController()
    let scored = 0
    const cache: AnalyseCache = {
      packages: async () => {
        if (++scored === 2) controller.abort()
        return pkg('x', [['1.0.0', '2025-01-01T00:00:00Z']])
      },
    }
    const deps = Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, current: '1.0.0', resolved: true }))

    await expect(analyse(manifest(deps), { cache, concurrency: 1, signal: controller.signal })).rejects.toThrow(
      'scan cancelled',
    )
    // Whatever was already in flight finishes; the rest is never requested.
    expect(scored).toBeLessThan(deps.length)
  })

  it('runs to the end when the signal never aborts', async () => {
    const { cache } = cannedCache({ 'npm:a': pkg('a', [['1.0.0', '2025-01-01T00:00:00Z']]) })
    const r = await analyse(manifest([{ name: 'a', current: '1.0.0', resolved: true }]), {
      cache,
      signal: new AbortController().signal,
    })
    expect(r.deps).toHaveLength(1)
  })
})
