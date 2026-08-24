// The libyear engine: manifest parsing for npm and PyPI, and the drift metric
// itself.
//
// Libyear is Cox, Bouwers, van Eekelen & Visser, "Measuring Dependency Freshness
// in Software Systems" (ICSE 2015): the age gap between the version you run and
// the version that is current. Pulse — how long since the package shipped
// anything at all — is jdanil/libyear's split, and comes free from the same
// version list.

import { compareVersions, isPrerelease } from '../semver.js'
import type { RegistryVersion } from '../registry-client.js'

export interface Dep {
  name: string
  current: string
  resolved: boolean // true when the version came from a lock file or an SBOM
  ecosystem?: string // set only when the input mixes ecosystems (an SBOM)
}

export interface DepFreshness extends Dep {
  latest: string | null
  libyearsBehind: number
  currentReleased: string | null
  latestReleased: string | null
  pulseYears: number | null
}

export interface LibyearReport {
  totalLibyears: number
  worst: DepFreshness[]
}

const MS_PER_YEAR = 365.25 * 86_400_000
const WORST_N = 5

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Scores one dependency's drift against a registry's version list.
 *
 * Drift is the age gap between the release you run and the newest one, in
 * years. Undatable at either end scores 0 rather than a guess: a metric people
 * gate on has to be objectively computable, and "we could not date it" is not
 * evidence of freshness or of staleness.
 *
 * @param dep      The dependency and the version in the manifest or lock.
 * @param versions Every version the registry knows about, with release dates.
 * @param asOf     Instant to measure pulse against; overridden in trend mode so
 *                 a past commit is scored as of its own date.
 * @returns The dependency with its drift, pulse and both release dates.
 */
export function libyearsForDep(dep: Dep, versions: RegistryVersion[], asOf = Date.now()): DepFreshness {
  // A package that has only ever shipped prereleases still has a latest.
  const stable = versions.filter((v) => !isPrerelease(v.version))
  const latest = newest(stable.length > 0 ? stable : versions)
  const current = matchVersion(versions, dep.current)

  const currentReleased = current?.released ?? null
  const latestReleased = latest?.released ?? null
  // Undatable at either end is unknown, and unknown is 0 — reporting a guess as
  // drift is how a metric stops being worth acting on.
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

function newest(versions: RegistryVersion[]): RegistryVersion | null {
  return versions.reduce<RegistryVersion | null>(
    (best, v) => (!best || compareVersions(v.version, best.version) > 0 ? v : best),
    null,
  )
}

// Exact match first. A manifest range reduced to its floor loses the patch
// segment ("1.38" for "^1.38"), so fall back to the newest release at or below
// what we have rather than scoring the dep as undatable.
function matchVersion(versions: RegistryVersion[], current: string): RegistryVersion | null {
  const exact = versions.find((v) => v.version === current)
  if (exact) return exact
  return newest(versions.filter((v) => compareVersions(v.version, current) <= 0))
}

/**
 * Totals the drift across a manifest and names the worst offenders.
 *
 * @param deps Every scored dependency.
 * @returns The summed libyears and the five deepest in debt.
 */
export function buildReport(deps: DepFreshness[]): LibyearReport {
  return {
    totalLibyears: round2(deps.reduce((sum, d) => sum + d.libyearsBehind, 0)),
    worst: [...deps].sort((a, b) => b.libyearsBehind - a.libyearsBehind).slice(0, WORST_N),
  }
}

// --- manifest parsing ---

export type ManifestKind = 'npm' | 'package-lock' | 'yarn-lock' | 'pnpm-lock' | 'pep440'

/**
 * Identifies what a file is from its contents.
 *
 * Content, not filename: a lock read as a manifest (or the reverse) produces a
 * wrong number with no error, and the caller cannot always trust the path it
 * was handed (`git show <sha>:file`, stdin, a renamed file).
 *
 * @param text The file's contents.
 * @returns The manifest kind, or null when nothing matches.
 */
export function detectKind(text: string): ManifestKind | null {
  const head = text.trimStart()
  if (head.startsWith('{')) {
    const doc = parseJson(head)
    if (!doc) return null
    if (doc.lockfileVersion !== undefined) return 'package-lock'
    if (doc.dependencies || doc.devDependencies || doc.name) return 'npm'
    return null
  }
  if (/^#\s*yarn lockfile/m.test(head) || /^__metadata:/m.test(head)) return 'yarn-lock'
  if (/^lockfileVersion:/m.test(head)) return 'pnpm-lock'
  return null
}

/**
 * Extracts the dependency list from a manifest or lock file.
 *
 * @param text The file's contents.
 * @param kind Which format to read it as — see {@link detectKind}.
 * @returns One entry per dependency, with `resolved` set when the version came
 *          from a lock rather than a range.
 */
export function parseManifest(text: string, kind: ManifestKind): Dep[] {
  switch (kind) {
    case 'npm':
      return parsePackageJson(text)
    case 'package-lock':
      return parsePackageLock(text)
    case 'yarn-lock':
      return parseYarnLock(text)
    case 'pnpm-lock':
      return parsePnpmLock(text)
    case 'pep440':
      return parseRequirements(text)
  }
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// A range states a floor, not an installed version — that is why resolved is
// false here and true for every lock parser below.
function rangeFloor(range: string): string | null {
  // workspace:/file:/git: name a source, not a registry version; a "/" means a
  // shorthand git spec ("user/repo#v1.2.3") whose tag is not a published version.
  if (/^[a-z+]+:/i.test(range) || range.includes('/')) return null
  return range.match(/\d+(?:\.\d+)*/)?.[0] ?? null
}

// peerDependencies are provided by the host, not installed here, so they are not
// this project's drift to carry.
const NPM_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']

function parsePackageJson(text: string): Dep[] {
  const doc = parseJson(text)
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const section of NPM_SECTIONS) {
    for (const [name, range] of Object.entries<unknown>(doc?.[section] ?? {})) {
      const current = rangeFloor(String(range))
      if (!current || seen.has(name)) continue
      seen.add(name)
      deps.push({ name, current, resolved: false })
    }
  }
  return deps
}

function parsePackageLock(text: string): Dep[] {
  const doc = parseJson(text)
  const deps: Dep[] = []
  const seen = new Set<string>()
  const add = (name: string, version: unknown) => {
    if (!name || typeof version !== 'string' || seen.has(name)) return
    seen.add(name)
    deps.push({ name, current: version, resolved: true })
  }

  // v2/v3: a flat "packages" map keyed by install path, "" being the project.
  for (const [path, entry] of Object.entries<any>(doc?.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/')
    if (at === -1) continue
    add(path.slice(at + 'node_modules/'.length), entry?.version)
  }
  // v1: a nested tree instead. v2 carries both, so only fall back when empty.
  if (deps.length === 0) {
    const walk = (tree: Record<string, any> | undefined) => {
      for (const [name, entry] of Object.entries(tree ?? {})) {
        add(name, entry?.version)
        walk(entry?.dependencies)
      }
    }
    walk(doc?.dependencies)
  }
  return deps
}

// "@scope/pkg@npm:^1.2.3" -> "@scope/pkg": the last "@" starts the range, and a
// leading one belongs to the scope.
function specName(spec: string): string | null {
  const bare = spec.trim().replace(/^"|"$/g, '')
  const at = bare.lastIndexOf('@')
  return at > 0 ? bare.slice(0, at) : null
}

// yarn v1 ("pkg@^1.0.0:" then indented `version "1.2.3"`) and berry (YAML,
// `"pkg@npm:^1.0.0":` then `version: 1.2.3`). Same shape, different quoting —
// one loop reads both. Entry headers list every range that resolved to the same
// version, comma-separated.
function parseYarnLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let names: string[] = []
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      names = raw
        .replace(/:\s*$/, '')
        .split(',')
        .map((s) => specName(s))
        .filter((n): n is string => n !== null)
      continue
    }
    const version = raw.match(/^\s+"?version"?[:\s]+"?([^"\s]+)"?\s*$/)?.[1]
    if (!version || names.length === 0) continue
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      deps.push({ name, current: version, resolved: true })
    }
    names = []
  }
  return deps
}

// pnpm's "packages:" keys are "/@scope/pkg/1.2.3(peer)" (v5/v6) or
// "@scope/pkg@1.2.3" (v9). Peer suffixes are resolution detail, not version.
function parsePnpmLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let inPackages = false
  for (const raw of text.split('\n')) {
    if (/^\S/.test(raw)) {
      inPackages = raw.startsWith('packages:')
      continue
    }
    if (!inPackages) continue
    const key = raw.match(/^ {2}'?([^'":]+)'?:\s*$/)?.[1]
    if (!key) continue
    const spec = key.replace(/\(.*\)$/, '')
    const m = spec.startsWith('/') ? spec.match(/^\/(.+)\/([^/]+)$/) : spec.match(/^(.+)@([^@]+)$/)
    if (!m) continue
    const [, name, version] = m
    if (seen.has(name) || !/^\d/.test(version)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: true })
  }
  return deps
}

// requirements.txt: "==" pins, every other operator states a floor. Option lines
// ("-r other.txt", "-e .") are not packages.
function parseRequirements(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('-')) continue
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(==|~=|>=|<=|>|<|!=)\s*([^,;\s]+)/)
    if (!m) continue
    const [, name, op, version] = m
    const current = version.match(/\d+(?:\.\d+)*/)?.[0]
    if (!current || seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current, resolved: op === '==' })
  }
  return deps
}
