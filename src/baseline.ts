// Accepting what is already there.
//
// A repository that has been running for years opens the pane at 88 libyears
// and fifty-odd dependencies to address. All of it is true and none of it is
// news, and a list that never empties is a list people stop reading. A baseline
// records what today looks like; afterwards the pane shows what got worse.
//
// Two things count as worse, and both matter: more drift than was accepted, and
// a worse quadrant at the same drift — a dependency whose maintainer walked away
// since you accepted it has changed in exactly the way this tool exists to
// notice. Anything else stays quiet.
//
// Pure: reading and writing the file is the caller's business, which is what
// lets the CLI and the editor share one answer to "what do we already accept".

import { compareDeps, type DepReport, QUADRANT_ORDER, type Quadrant, type Report } from './report.js'

export const BASELINE_VERSION = 1

/**
 * Where a baseline lives when nobody says otherwise. Shared so `depwatch check`
 * and the editor look in the same place — a baseline only earns its keep if
 * both honour it.
 */
export const DEFAULT_BASELINE = '.depwatch-baseline.json'

interface Accepted {
  /** Libyears behind when this was accepted. */
  ly: number
  q: Quadrant
}

export interface Baseline {
  version: number
  generatedAt: string
  /** Workspace-relative manifest path -> dependency name -> what was accepted. */
  manifests: Record<string, Record<string, Accepted>>
}

// Rank as "how bad": replace is 0. A dependency is worse when its rank falls.
const RANK = new Map(QUADRANT_ORDER.map((q, i) => [q, i]))

// Floating point: a dependency does not become "worse" because a rounded number
// moved in the last decimal place.
const EPSILON = 0.005

export function serialise(scans: { label: string; report: Report }[], generatedAt: string): string {
  const manifests: Baseline['manifests'] = {}
  for (const { label, report } of scans) {
    const findings = report.deps.filter(worthAccepting)
    if (findings.length === 0) continue
    manifests[label] = Object.fromEntries(
      [...findings].sort(compareDeps).map((d) => [d.name, { ly: d.libyearsBehind, q: d.quadrant }]),
    )
  }
  return `${JSON.stringify({ version: BASELINE_VERSION, generatedAt, manifests }, null, 2)}\n`
}

// Healthy dependencies are not findings, so accepting them would only make the
// file bigger. One that stops being healthy is new, which is the point.
const worthAccepting = (d: DepReport) => !d.degraded && d.quadrant !== 'healthy'

export function parse(text: string): Baseline | null {
  try {
    const doc = JSON.parse(text) as Baseline
    if (doc?.version !== BASELINE_VERSION || typeof doc.manifests !== 'object') return null
    return doc
  } catch {
    return null // a hand-edited file that no longer parses accepts nothing
  }
}

/** The dependencies of this manifest that the baseline already accounts for. */
export function acceptedIn(baseline: Baseline | null, label: string, report: Report): Set<string> {
  const accepted = new Set<string>()
  const entries = baseline?.manifests[label]
  if (!entries) return accepted

  for (const dep of report.deps) {
    const was = entries[dep.name]
    if (!was) continue // not accepted, or newly a finding
    if (dep.libyearsBehind > was.ly + EPSILON) continue // drifted further
    if ((RANK.get(dep.quadrant) ?? 0) < (RANK.get(was.q) ?? 0)) continue // fell to a worse quadrant
    accepted.add(dep.name)
  }
  return accepted
}

/**
 * The report as the pane should show it. Accepted dependencies are dropped
 * rather than flagged, and the total is recomputed from what is left — a
 * baselined project reads "0.00 libyears · nothing to address", which is the
 * honest summary of "nothing has got worse since you accepted it".
 */
export function withoutAccepted(report: Report, accepted: Set<string>): Report {
  if (accepted.size === 0) return report
  const deps = report.deps.filter((d) => !accepted.has(d.name))
  return {
    ...report,
    deps,
    totalLibyears: Math.round(deps.reduce((sum, d) => sum + d.libyearsBehind, 0) * 100) / 100,
    worst: report.worst.filter((d) => !accepted.has(d.name)),
  }
}
