// Viability axis. Drift answers "how far behind"; viability answers "can you even
// catch up, or is the project dead". These are orthogonal, and plotting them
// together is depwatch's differentiator.
//
// Every signal is optional: most come free from the version timeline the
// registry already returns, the rest only when a repo host is reachable. Missing
// signals are dropped and the remaining weights renormalised, so a package with
// only a release history still gets an honest score rather than a penalty for
// data we could not fetch.

export interface ViabilitySignals {
  lastReleaseAgeDays: number | null // "pulse" — long gaps suggest abandonment
  lastCommitAgeDays: number | null
  archived: boolean // hard signal of death
  openIssuesRatio: number | null // fraction of known issues still open
  releaseCadenceDays: number | null // median gap between releases
  maintainerCount: number | null // bus factor
  hasFunding: boolean
}

export const NO_SIGNALS: ViabilitySignals = {
  lastReleaseAgeDays: null,
  lastCommitAgeDays: null,
  archived: false,
  openIssuesRatio: null,
  releaseCadenceDays: null,
  maintainerCount: null,
  hasFunding: false,
}

// Weights are relative, not absolute: only the signals actually present are
// summed and divided by their own total. Pulse dominates because it is the one
// signal available for every package in every ecosystem.
const WEIGHTS = {
  pulse: 0.4,
  commit: 0.2,
  cadence: 0.2,
  busFactor: 0.15,
  issues: 0.05,
} as const

const FUNDING_BONUS = 0.05

// 1 while age <= good, 0 once age >= dead, linear between. Deliberately linear:
// a curve would imply a precision these signals do not have.
function decay(age: number, good: number, dead: number): number {
  if (age <= good) return 1
  if (age >= dead) return 0
  return (dead - age) / (dead - good)
}

function busFactor(maintainers: number): number {
  if (maintainers <= 0) return 0
  if (maintainers === 1) return 0.4 // one person is one bus
  if (maintainers === 2) return 0.7
  return 1
}

/**
 * Returns 0..1, higher = healthier.
 *
 * Calibrated in viability.test.ts against synthetic profiles of known-dead and
 * known-alive shapes rather than live packages, so the thresholds stay testable
 * offline. Re-check those cases whenever a weight moves.
 */
export function viabilityScore(s: ViabilitySignals): number {
  // Archived is not a weighted signal — the maintainer has said the project is
  // over. Nothing else outvotes that.
  if (s.archived) return 0

  let sum = 0
  let weight = 0
  const add = (w: number, value: number | null) => {
    if (value === null) return
    sum += w * value
    weight += w
  }

  // A release within six months is alive; three years without one is not.
  add(WEIGHTS.pulse, s.lastReleaseAgeDays === null ? null : decay(s.lastReleaseAgeDays, 180, 1095))
  // Commits keep scoring after releases stop — a stable library still gets fixes.
  add(WEIGHTS.commit, s.lastCommitAgeDays === null ? null : decay(s.lastCommitAgeDays, 90, 730))
  // Median gap between releases: quarterly is healthy, two-yearly is not.
  add(WEIGHTS.cadence, s.releaseCadenceDays === null ? null : decay(s.releaseCadenceDays, 90, 730))
  add(WEIGHTS.busFactor, s.maintainerCount === null ? null : busFactor(s.maintainerCount))
  add(WEIGHTS.issues, s.openIssuesRatio === null ? null : 1 - clamp01(s.openIssuesRatio))

  // No signals at all: unknown, not dead. 0.5 keeps it off both extremes of the
  // quadrant so nobody acts on an absence of data.
  if (weight === 0) return 0.5

  const score = sum / weight
  return clamp01(s.hasFunding ? score + FUNDING_BONUS : score)
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
