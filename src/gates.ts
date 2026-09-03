// The gates: the checks that turn a report into a pass or a failure.
//
// `depwatch check --ci` was the only caller while these lived inside the CLI.
// The editor extension is the second, and a gate that says "fail" in CI and
// "fine" in the IDE is worse than no gate at all — so there is one
// implementation and one verdict, and both surfaces read it.

import type { DepReport, Report } from './report.js'
import { round2 } from './round.js'

export interface Gates {
  maxLibyears?: number
  maxReplace?: number
  /**
   * Ceiling on how much drift may *grow* against {@link baselineLibyears} —
   * the ratchet. An absolute budget is the wrong shape for a repository that
   * is already behind: set it above today's number and it never fires, set it
   * below and every pull request is red for a debt it did not create. A
   * ratchet gates from the first day: whatever the total is, do not make it
   * worse. 0 means "must not grow at all".
   */
  maxLibyearsIncrease?: number
  /** Total drift of the baseline, e.g. the pull request's base branch. */
  baselineLibyears?: number
}

export interface GateFailure {
  gate: 'max-libyears' | 'max-replace' | 'max-libyears-increase'
  message: string
}

export type QuadrantCounts = Record<DepReport['quadrant'], number>

/**
 * A zeroed quadrant tally.
 *
 * @returns One counter per quadrant, all at zero.
 */
export const emptyCounts = (): QuadrantCounts => ({ healthy: 0, upgrade: 0, watch: 0, replace: 0 })

/**
 * Counts a report's dependencies by quadrant.
 *
 * Degraded deps are left out: one we could not reach is unknown, not unhealthy,
 * and counting unknowns towards a threshold turns a flaky registry into what
 * looks like a regression in the manifest.
 *
 * @param r The report.
 * @returns The per-quadrant counts.
 */
export function tally(r: Report): QuadrantCounts {
  const counts = emptyCounts()
  for (const d of r.deps) if (!d.degraded) counts[d.quadrant]++
  return counts
}

/**
 * Applies the configured gates and returns every failure, with its reason.
 *
 * Non-zero exit is the whole point of CI mode, so each failure carries a
 * message naming the threshold and the value that crossed it. One
 * implementation serves both the CLI and the editor extension: a gate that says
 * "fail" in CI and "fine" in the IDE is worse than no gate at all.
 *
 * @param r The report.
 * @param g The thresholds to apply; an unset one is not checked.
 * @returns Every failure, or an empty array when the report passes.
 */
export function gateFailures(r: Report, g: Gates): GateFailure[] {
  const fails: GateFailure[] = []
  if (g.maxLibyears !== undefined && r.totalLibyears > g.maxLibyears) {
    fails.push({
      gate: 'max-libyears',
      message: `total drift ${r.totalLibyears.toFixed(2)} libyears exceeds --max-libyears ${g.maxLibyears}`,
    })
  }
  // Compared at the two decimals every surface reports, not at full float
  // precision: 3.10 -> 3.52 is a growth of 0.42000000000000004, and a ratchet
  // set to 0 must not fail a manifest that did not change because of it.
  if (g.maxLibyearsIncrease !== undefined && g.baselineLibyears !== undefined) {
    const grew = round2(round2(r.totalLibyears) - round2(g.baselineLibyears))
    if (grew > g.maxLibyearsIncrease) {
      fails.push({
        gate: 'max-libyears-increase',
        message:
          `drift grew by ${grew.toFixed(2)} libyears ` +
          `(${g.baselineLibyears.toFixed(2)} → ${r.totalLibyears.toFixed(2)}), ` +
          `more than --max-libyears-increase ${g.maxLibyearsIncrease}`,
      })
    }
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
