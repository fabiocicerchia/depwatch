// Turning a manifest into the two-axis report the quadrant plots.

import { fetchPackage, type PackageInfo, type RegistryError, type RegistryVersion } from '@lib/registry-client'
import { buildReport, libyearsForDep, type Dep, type DepFreshness } from '@lib/libyear/engine'
import type { Manifest } from './manifest.js'
import { applyDeepMeta, type DeepMeta, fetchDeepMeta, timelineSignals } from './signals.js'
import { NO_SIGNALS, viabilityScore, type ViabilitySignals } from './viability.js'

export type Quadrant = 'healthy' | 'upgrade' | 'watch' | 'replace'

export interface DepReport extends DepFreshness {
  viability: number
  quadrant: Quadrant
  // What the viability score was computed from. A number on its own is not an
  // explanation, and every surface that shows the score is asked "why".
  signals: ViabilitySignals
  degraded?: string // why this dep has no registry data
}

export interface Report {
  file: string
  ecosystem: string
  generatedAt: string
  totalLibyears: number
  deps: DepReport[]
  worst: DepReport[]
}

export interface Thresholds {
  staleLibyears: number // above this, "behind"
  riskyViability: number // below this, "fading"
}

export const DEFAULT_THRESHOLDS: Thresholds = { staleLibyears: 1, riskyViability: 0.5 }

// Quadrant classification: the whole point of the tool.
export function quadrant(libyearsBehind: number, viability: number, t = DEFAULT_THRESHOLDS): Quadrant {
  const stale = libyearsBehind > t.staleLibyears
  const risky = viability < t.riskyViability
  if (stale && risky) return 'replace' // behind AND unmaintained — the danger zone
  if (stale && !risky) return 'upgrade' // behind but alive — just do the work
  if (!stale && risky) return 'watch' // current but the project is fading
  return 'healthy'
}

export interface AnalyseOptions {
  deep?: boolean
  now?: number
  concurrency?: number
  thresholds?: Thresholds
  // Only consider versions released at or before this instant. Used by trend
  // mode to reconstruct what the report would have said at an older commit.
  asOf?: number
  // Where fetched data is remembered. Defaults to a process-lifetime map, which
  // is all a CLI run needs; a long-lived host (the editor extension) hands in
  // one that survives restarts so a second scan costs no requests at all.
  cache?: AnalyseCache
}

// A cache wraps the loader rather than replacing it: which URL gets called
// stays here, and the caller only decides where the answer is kept and for how
// long. Both values are safe to keep — neither depends on the current time.
export interface AnalyseCache {
  packages: CacheLayer<PackageInfo | RegistryError>
  deep?: CacheLayer<DeepMeta>
}

export type CacheLayer<T> = (key: string, load: () => Promise<T>) => Promise<T>

// Registries rate-limit, and a big manifest is hundreds of packages. Six at a
// time has never tripped a 429 in practice; lower it if one does.
const DEFAULT_CONCURRENCY = 6

// The shared registry-client caches in sessionStorage, which does not exist
// under Node — so cache here instead. Trend mode analyses the same manifest at
// many commits and would otherwise refetch every package once per commit.
function memoise<T>(): CacheLayer<T> {
  const store = new Map<string, Promise<T>>()
  return (key, load) => {
    let hit = store.get(key)
    if (!hit) {
      hit = load()
      store.set(key, hit)
    }
    return hit
  }
}

const DEFAULT_CACHE: AnalyseCache = { packages: memoise(), deep: memoise() }

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function analyse(manifest: Manifest, opts: AnalyseOptions = {}): Promise<Report> {
  const now = opts.now ?? Date.now()
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS
  const asOf = opts.asOf ?? now

  const deps = await mapPool(manifest.deps, opts.concurrency ?? DEFAULT_CONCURRENCY, (dep) =>
    analyseDep(manifest, dep, { ...opts, now, thresholds, asOf }),
  )

  const summary = buildReport(deps)
  const byName = new Map(deps.map((d) => [d.name, d]))
  return {
    file: manifest.file,
    ecosystem: manifest.ecosystem,
    generatedAt: new Date(now).toISOString(),
    totalLibyears: summary.totalLibyears,
    deps,
    worst: summary.worst.map((d) => byName.get(d.name)!).filter(Boolean),
  }
}

async function analyseDep(
  manifest: Manifest,
  dep: Dep,
  opts: Required<Pick<AnalyseOptions, 'now' | 'thresholds' | 'asOf'>> & AnalyseOptions,
): Promise<DepReport> {
  // An SBOM can carry npm, PyPI and Cargo components in one file, so the dep's
  // own ecosystem wins over the containing manifest's when it has one.
  const eco = (dep.ecosystem as Manifest['ecosystem']) ?? manifest.ecosystem
  const cache = opts.cache ?? DEFAULT_CACHE
  const key = `${eco}:${dep.name.toLowerCase()}`
  const info = await cache.packages(key, () => fetchPackage(eco, dep.name))
  if ('error' in info) {
    // A dep we could not reach is unknown, not healthy — say so instead of
    // scoring it 0 and sending someone to replace a fine package.
    return {
      name: dep.name,
      current: dep.current,
      resolved: dep.resolved,
      latest: null,
      libyearsBehind: 0,
      currentReleased: null,
      latestReleased: null,
      pulseYears: null,
      viability: 0.5,
      quadrant: 'healthy',
      signals: { ...NO_SIGNALS },
      degraded: info.error,
    }
  }

  const versions = versionsAsOf(info, opts.asOf)
  const freshness = libyearsForDep(dep, versions, opts.asOf)
  let signals = timelineSignals(versions, opts.asOf)
  if (opts.deep) {
    const meta = await (cache.deep ?? DEFAULT_CACHE.deep!)(key, () => fetchDeepMeta(eco, dep.name))
    signals = applyDeepMeta(signals, meta, opts.asOf)
  }
  const viability = round2(viabilityScore(signals))

  return { ...freshness, viability, quadrant: quadrant(freshness.libyearsBehind, viability, opts.thresholds), signals }
}

// Release dates are historical facts, so "what did this manifest look like in
// 2023" is answerable from today's version list by hiding later releases.
function versionsAsOf(info: PackageInfo, asOf: number): RegistryVersion[] {
  if (asOf >= Date.now()) return info.versions
  return info.versions.filter((v: RegistryVersion) => !v.released || Date.parse(v.released) <= asOf)
}

const round2 = (n: number) => Math.round(n * 100) / 100
