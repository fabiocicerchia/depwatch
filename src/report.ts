// Turning a manifest into the two-axis report the quadrant plots.

import type { RegistryVersion } from '@lib/registry-client'
import { buildReport, libyearsForDep, type Dep, type DepFreshness } from '@lib/libyear/engine'
import type { Manifest } from './manifest.js'
import { byId } from './ecosystems/registry.js'
import type { EcosystemDef, VersionOps } from './ecosystems/types.js'
import { deepSignals, timelineSignals } from './signals.js'
import { viabilityScore } from './viability.js'

export type Quadrant = 'healthy' | 'upgrade' | 'watch' | 'replace'

export interface DepReport extends DepFreshness {
  viability: number
  quadrant: Quadrant
  degraded?: string // why this dep has no registry data
  // Set when the ecosystem has dates but no orderable version series (Docker):
  // pulse and viability are real, drift is not computed.
  driftUnscored?: boolean
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
}

// Registries rate-limit, and a big manifest is hundreds of packages. Six at a
// time has never tripped a 429 in practice; lower it if one does.
const DEFAULT_CONCURRENCY = 6

// How many of the most recent versions to date when a registry lists them
// undated. Covers latest-selection plus the cadence/pulse window (signals.ts
// CADENCE_WINDOW = 10) with headroom, so a handful of requests per package.
const DATE_WINDOW = 12

// The shared registry-client caches in sessionStorage, which does not exist
// under Node — so cache here instead. Trend mode analyses the same manifest at
// many commits and would otherwise refetch every package once per commit.
interface Fetched {
  versions: RegistryVersion[]
}
interface FetchError {
  error: string
}

const packageCache = new Map<string, Promise<Fetched | FetchError>>()

// One responsibility per ecosystem def: fetch the version list. Failures become
// values here so one unreachable package degrades to "unknown" in the report
// rather than aborting the whole manifest.
async function fetchVersions(def: EcosystemDef, name: string): Promise<Fetched | FetchError> {
  try {
    const versions = await def.fetchVersions(name)
    if (versions.length === 0) return { error: 'registry returned no versions' }
    return { versions }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function cachedFetch(def: EcosystemDef, name: string): Promise<Fetched | FetchError> {
  // Scoped ecosystems (Helm) key on the repository, not the bare name — one
  // index.yaml covers every chart in it. The name already carries that prefix.
  const key = `${def.id}:${name.toLowerCase()}`
  let hit = packageCache.get(key)
  if (!hit) {
    hit = fetchVersions(def, name)
    packageCache.set(key, hit)
  }
  return hit
}

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
  const def = byId(eco)
  if (!def) return degraded(dep, `unsupported ecosystem "${eco}"`)
  const info = await cachedFetch(def, dep.name)
  if ('error' in info) {
    // A dep we could not reach is unknown, not healthy — say so instead of
    // scoring it 0 and sending someone to replace a fine package.
    return degraded(dep, info.error)
  }

  let versions = versionsAsOf(info.versions, opts.asOf)
  // A pulse-only ecosystem dates the exact current tag, which may fall outside
  // the recent-tags window fetchVersions returns — add it so hydration reaches it.
  if (def.driftScorable === false && !versions.some((v) => v.version === dep.current)) {
    versions = [...versions, { version: dep.current, released: null }]
  }
  // Some registries list versions without dates; date only the ones we score.
  if (def.hydrateDates) versions = await hydrateScored(def, dep, versions)

  const freshness = freshnessFor(def, dep, versions, opts.asOf)
  let signals = timelineSignals(versions, opts.asOf)
  if (opts.deep) signals = await deepSignals(eco, dep.name, signals, opts.asOf)
  const viability = round2(viabilityScore(signals))

  // Docker and the like have honest dates but no orderable series: score pulse
  // and viability, and report drift as unknown rather than a misleading 0.
  // Pulse is the age of the CURRENT tag, not of a "latest" the series cannot
  // order.
  if (def.driftScorable === false) {
    const pulseYears = freshness.currentReleased
      ? round2(Math.max(0, (opts.now - Date.parse(freshness.currentReleased)) / MS_PER_YEAR))
      : null
    return {
      ...freshness,
      libyearsBehind: 0,
      latest: null,
      pulseYears,
      viability,
      quadrant: 'healthy',
      driftUnscored: true,
    }
  }

  return { ...freshness, viability, quadrant: quadrant(freshness.libyearsBehind, viability, opts.thresholds) }
}

function degraded(dep: Dep, reason: string): DepReport {
  return {
    name: dep.name,
    current: dep.current,
    resolved: dep.resolved,
    ecosystem: dep.ecosystem,
    latest: null,
    libyearsBehind: 0,
    currentReleased: null,
    latestReleased: null,
    pulseYears: null,
    viability: 0.5,
    quadrant: 'healthy',
    degraded: reason,
  }
}

// Freshness (drift + pulse). Default ecosystems use the shared @lib engine
// verbatim, so their numbers are unchanged; ecosystems with a version grammar
// the shared comparator misreads (Maven, conda) supply their own ops.
function freshnessFor(def: EcosystemDef, dep: Dep, versions: RegistryVersion[], asOf: number): DepFreshness {
  if (!def.versionOps) return libyearsForDep(dep, versions, asOf)
  return libyearsWithOps(dep, versions, asOf, def.versionOps)
}

// The versions worth dating: the current one, and the most recent slice the
// cadence/pulse signals look at. Bounds the per-version date requests to a
// handful per package rather than the whole history.
async function hydrateScored(def: EcosystemDef, dep: Dep, versions: RegistryVersion[]): Promise<RegistryVersion[]> {
  const undated = versions.filter((v) => !v.released)
  if (undated.length === 0) return versions
  const wanted = new Set<string>()
  wanted.add(dep.current)
  for (const v of versions.slice(-DATE_WINDOW)) wanted.add(v.version)
  const targets = undated.filter((v) => wanted.has(v.version)).map((v) => v.version)
  if (targets.length === 0) return versions
  const dates = await def.hydrateDates!(dep.name, targets)
  return versions.map((v) => (v.released ? v : { ...v, released: dates.get(v.version) ?? null }))
}

// Release dates are historical facts, so "what did this manifest look like in
// 2023" is answerable from today's version list by hiding later releases.
function versionsAsOf(versions: RegistryVersion[], asOf: number): RegistryVersion[] {
  if (asOf >= Date.now()) return versions
  return versions.filter((v) => !v.released || Date.parse(v.released) <= asOf)
}

const round2 = (n: number) => Math.round(n * 100) / 100

const MS_PER_YEAR = 365.25 * 86_400_000

// A faithful port of @lib/libyear/engine's libyearsForDep, parameterised by the
// version comparator so ecosystems with a non-standard grammar (Maven, conda)
// order their versions correctly. The drift *maths* are identical to the shared
// engine; only the ordering is pluggable.
function libyearsWithOps(dep: Dep, versions: RegistryVersion[], asOf: number, ops: VersionOps): DepFreshness {
  const newest = (vs: RegistryVersion[]): RegistryVersion | null =>
    vs.reduce<RegistryVersion | null>((best, v) => (!best || ops.compare(v.version, best.version) > 0 ? v : best), null)

  const stable = versions.filter((v) => !ops.isPrerelease(v.version))
  const latest = newest(stable.length > 0 ? stable : versions)

  const exact = versions.find((v) => v.version === dep.current)
  const current = exact ?? newest(versions.filter((v) => ops.compare(v.version, dep.current) <= 0))

  const currentReleased = current?.released ?? null
  const latestReleased = latest?.released ?? null
  const behind =
    currentReleased && latestReleased ? (Date.parse(latestReleased) - Date.parse(currentReleased)) / MS_PER_YEAR : 0

  return {
    ...dep,
    latest: latest?.version ?? null,
    libyearsBehind: round2(Math.max(0, behind)),
    currentReleased,
    latestReleased,
    pulseYears: latestReleased ? round2(Math.max(0, (asOf - Date.parse(latestReleased)) / MS_PER_YEAR)) : null,
  }
}
