// The gates: the checks that turn a report into a pass or a failure.
//
// `depwatch check --ci` was the only caller while these lived inside the CLI.
// The editor extension is the second, and a gate that says "fail" in CI and
// "fine" in the IDE is worse than no gate at all — so there is one
// implementation and one verdict, and both surfaces read it.

import type { DepReport, Report } from './report.js'

export interface Gates {
  maxLibyears?: number
  maxReplace?: number
}

export interface GateFailure {
  gate: 'max-libyears' | 'max-replace'
  message: string
}

export type QuadrantCounts = Record<DepReport['quadrant'], number>

// Degraded deps are left out: one we could not reach is unknown, not unhealthy,
// and counting unknowns towards a threshold turns a flaky registry into what
// looks like a regression in the manifest.
export function tally(r: Report): QuadrantCounts {
  const counts: QuadrantCounts = { healthy: 0, upgrade: 0, watch: 0, replace: 0 }
  for (const d of r.deps) if (!d.degraded) counts[d.quadrant]++
  return counts
}

// Non-zero exit is the whole point of CI mode, so be explicit about why.
export function gateFailures(r: Report, g: Gates): GateFailure[] {
  const fails: GateFailure[] = []
  if (g.maxLibyears !== undefined && r.totalLibyears > g.maxLibyears) {
    fails.push({
      gate: 'max-libyears',
      message: `total drift ${r.totalLibyears.toFixed(2)} libyears exceeds --max-libyears ${g.maxLibyears}`,
    })
  }
  const replace = tally(r).replace
  if (g.maxReplace !== undefined && replace > g.maxReplace) {
    fails.push({
      gate: 'max-replace',
      message: `${replace} deps in the replace quadrant exceeds --max-replace ${g.maxReplace}`,
    })
  }
  return fails
}
