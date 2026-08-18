// The bottom line of the findings pane.
//
// A list of findings answers "what is wrong"; it does not answer "how much is
// there". That is what the last row is for — the drift you are carrying and how
// many dependencies it is spread across — so the pane can be read from the
// bottom as well as the top.
//
// Pure, and free of any `vscode` import, so the arithmetic is testable without
// an editor.

import { emptyCounts, tally, type QuadrantCounts } from '../../../src/gates.js'
import { QUADRANT_ORDER, type Quadrant, type Report } from '../../../src/report.js'
import { QUADRANT } from './explain.js'

/** A quadrant, or the pseudo-quadrant for deps the registry would not answer for. */
export type Lens = Quadrant | 'degraded'

export const LENSES: Lens[] = [...QUADRANT_ORDER, 'degraded']

export const LENS_LABEL: Record<Lens, string> = {
  replace: QUADRANT.replace.label,
  upgrade: QUADRANT.upgrade.label,
  watch: QUADRANT.watch.label,
  healthy: QUADRANT.healthy.label,
  degraded: 'no data',
}

export const LENS_BLURB: Record<Lens, string> = {
  replace: QUADRANT.replace.blurb,
  upgrade: QUADRANT.upgrade.blurb,
  watch: QUADRANT.watch.blurb,
  healthy: QUADRANT.healthy.blurb,
  degraded: 'the registry did not answer for these packages',
}

export interface Totals {
  libyears: number
  /** Every dependency in scope, scored or not. */
  deps: number
  counts: QuadrantCounts
  degraded: number
  /**
   * Everything off the healthy quadrant. Deps with no registry data are not in
   * here: unknown is not a to-do, and putting it in the number would make a
   * flaky registry look like work.
   */
  toAddress: number
}

export function totalsOf(reports: Report[]): Totals {
  const counts = emptyCounts()
  let libyears = 0
  let deps = 0
  let degraded = 0

  for (const report of reports) {
    libyears += report.totalLibyears
    deps += report.deps.length
    degraded += report.deps.filter((d) => d.degraded).length
    const own = tally(report)
    for (const q of QUADRANT_ORDER) counts[q] += own[q]
  }

  return {
    libyears: Math.round(libyears * 100) / 100,
    deps,
    counts,
    degraded,
    toAddress: counts.replace + counts.upgrade + counts.watch,
  }
}

export function summaryLabel(t: Totals): string {
  const drift = `${t.libyears.toFixed(2)} libyears`
  if (t.deps === 0) return drift
  if (t.toAddress === 0) return `${drift} · nothing to address`
  // The noun agrees with the set being counted from — "1 of 2 deps", not
  // "1 of 2 dep".
  return `${drift} · ${t.toAddress} of ${t.deps} ${t.deps === 1 ? 'dep' : 'deps'} to address`
}

/** What the count on the panel tab means — the Problems tab's trick, for deps. */
export type BadgeMode = 'toAddress' | 'total' | 'off'

export function badgeValue(mode: BadgeMode, t: Totals): number {
  if (mode === 'off') return 0
  return mode === 'total' ? t.deps : t.toAddress
}

export function badgeTooltip(mode: BadgeMode, t: Totals): string {
  const noun = (n: number) => `${n} ${n === 1 ? 'dependency' : 'dependencies'}`
  if (mode === 'total') {
    return `depwatch: ${noun(t.deps)} watched across the workspace, ${t.toAddress} to address`
  }
  const breakdown = summaryDetail({ ...t, counts: { ...t.counts, healthy: 0 }, degraded: 0 })
  return `depwatch: ${noun(t.toAddress)} to address of ${t.deps} across the workspace${breakdown ? ` — ${breakdown}` : ''}`
}

export function summaryDetail(t: Totals): string {
  const actionable = QUADRANT_ORDER.filter((q) => q !== 'healthy')
  const parts = actionable.filter((q) => t.counts[q] > 0).map((q) => `${t.counts[q]} ${q}`)
  if (t.counts.healthy > 0) parts.push(`${t.counts.healthy} healthy`)
  if (t.degraded > 0) parts.push(`${t.degraded} no data`)
  return parts.join(' · ')
}
