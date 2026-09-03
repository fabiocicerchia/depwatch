// Rendering the report as text, for the terminal.
//
// Its own module because the report's *shape* (report.ts) and the report's
// *appearance* change for different reasons and have different consumers — the
// editor extension renders the same REPORT_COLUMNS into a <table> and never
// wants a padded monospace one.

import { compareDeps, REPORT_COLUMNS, type Report, type Thresholds } from './report.js'
import { tally } from './gates.js'
import type { TrendPoint } from './trend.js'

// One row of the text table: each cell padded to its column's width, with the
// trailing padding of the last cell trimmed so lines have no invisible tail.
function padRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
}

export function table(r: Report, t: Thresholds): string {
  const rows = [...r.deps].sort(compareDeps)
  const widths = REPORT_COLUMNS.map((c) => Math.max(c.header.length, ...rows.map((d) => c.of(d).length)))

  const out = [
    padRow(
      REPORT_COLUMNS.map((c) => c.header),
      widths,
    ),
    padRow(
      widths.map((w) => '─'.repeat(w)),
      widths,
    ),
    ...rows.map((d) => padRow(REPORT_COLUMNS.map((c) => c.of(d)), widths)),
    '',
    `total drift: ${r.totalLibyears.toFixed(2)} libyears across ${r.deps.length} deps  (${r.ecosystem}, ${r.file})`,
  ]

  const counts = tally(r)
  out.push(`quadrants: replace ${counts.replace}  upgrade ${counts.upgrade}  watch ${counts.watch}  healthy ${counts.healthy}`)
  out.push(`thresholds: behind > ${t.staleLibyears} libyears, fading < ${t.riskyViability} viability`)

  const degraded = r.deps.filter((d) => d.degraded)
  if (degraded.length > 0) out.push(`${degraded.length} dep(s) had no registry data and were not scored`)

  const pulseOnly = r.deps.filter((d) => d.driftUnscored)
  if (pulseOnly.length > 0)
    out.push(`${pulseOnly.length} dep(s) scored on pulse and viability only — no comparable version series (drift shown as —)`)

  const estimated = r.deps.filter((d) => !d.resolved && !d.degraded).length
  if (estimated > 0) {
    out.push(
      `upper bound: ${estimated} of ${r.deps.length} versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower`,
    )
  }
  return out.join('\n')
}

export function trendTable(points: TrendPoint[]): string {
  const lines = points.map(
    (p) =>
      `${p.date.slice(0, 10)}  ${p.commit}  ${p.totalLibyears.toFixed(2).padStart(8)} libyears  ${String(p.deps).padStart(4)} deps  ${p.replace} replace`,
  )
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length > 1) {
    const delta = last.totalLibyears - first.totalLibyears
    lines.push('', `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} libyears over ${points.length} sampled commits`)
  }
  return lines.join('\n')
}
