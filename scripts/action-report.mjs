// Turns a `depwatch check --json` report into GitHub Actions step outputs and a
// job summary. Invoked by action.yml as:
//
//   node scripts/action-report.mjs <report.json> <gate-stderr> <exit-code> [baseline.json]
//
// It deliberately does not decide anything. The verdict is the CLI's exit code
// and the reasons are the CLI's stderr — src/gates.ts is the one implementation
// of both, and a summary that re-derived them could disagree with the check
// that actually failed the build.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const MARKER = '<!-- depwatch-action -->'

const [reportPath, gatePath, exitCodeArg, baselinePath] = process.argv.slice(2)
const exitCode = Number(exitCodeArg)

const report = JSON.parse(readFileSync(reportPath, 'utf8'))

// Present only when the ratchet ran. `null` covers both "no ratchet configured"
// and "the base ref could not be measured" — the action reports the second as a
// warning of its own, and neither should show up here as a delta of zero.
let baseline = null
if (baselinePath) {
  try {
    const total = JSON.parse(readFileSync(baselinePath, 'utf8')).totalLibyears
    if (typeof total === 'number' && Number.isFinite(total)) baseline = total
  } catch {
    // The action already warned; a summary without a delta is the graceful loss.
  }
}

// Rounded before subtracting, like the gate in src/gates.ts: a delta shown as
// +0.00 next to a build that passed a ratchet of 0 has to be the same arithmetic.
const round2 = (n) => Math.round(n * 100) / 100
const delta = baseline === null ? null : round2(round2(report.totalLibyears) - round2(baseline))
const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`

// The gate messages the CLI printed, if any. Missing or empty is the normal
// case: no --max-* flag was set, or nothing breached.
let gateMessages = []
try {
  gateMessages = readFileSync(gatePath, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^depwatch:\s*/, '').trim())
    .filter(Boolean)
} catch {
  // No stderr file — nothing was written, which is not an error.
}

// Same rule as src/gates.ts tally(): a dep the registry would not answer for is
// unknown, not unhealthy, so it is counted separately rather than as healthy.
const counts = { healthy: 0, upgrade: 0, watch: 0, replace: 0 }
let degraded = 0
for (const d of report.deps) {
  if (d.degraded) degraded++
  else counts[d.quadrant]++
}

const num = (n) => (typeof n === 'number' ? n.toFixed(2) : '—')

// A step output is parsed line by line as `key=value`, so a value carrying a
// newline would be read as the start of another output. Nothing here should
// contain one — but `file` and `ecosystem` are echoed from the measured input,
// and an output format is the wrong place to find out we were wrong.
const oneLine = (v) => String(v).replace(/[\r\n]+/g, ' ')

// Dependency names come from the manifest under test. Pipes and backticks would
// break out of the table cell they are rendered in.
const cell = (v) => String(v).replace(/[|`\r\n]/g, ' ')

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function setOutputs() {
  if (!process.env.GITHUB_OUTPUT) return
  const lines = [
    `libyears=${report.totalLibyears.toFixed(2)}`,
    `deps=${report.deps.length}`,
    `ecosystem=${oneLine(report.ecosystem)}`,
    `file=${oneLine(report.file)}`,
    `replace=${counts.replace}`,
    `upgrade=${counts.upgrade}`,
    `watch=${counts.watch}`,
    `healthy=${counts.healthy}`,
    `degraded=${degraded}`,
    `passed=${exitCode === 0}`,
    `report=${reportPath}`,
    `delta=${delta === null ? '' : signed(delta)}`,
  ]
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}

// Worst first, the order src/report.ts compareDeps defines for every surface.
const RANK = { replace: 0, upgrade: 1, watch: 2, healthy: 3 }
const worstFirst = (a, b) =>
  RANK[a.quadrant] - RANK[b.quadrant] || b.libyearsBehind - a.libyearsBehind || a.name.localeCompare(b.name)

const ICON = { replace: '🔴', upgrade: '🟠', watch: '🟡', healthy: '🟢' }

// The drift against the base branch, when the ratchet had one to compare to.
// Absent is not zero: no ratchet configured and an unmeasurable base ref both
// arrive here as null, and neither is "no change".
function deltaLines() {
  if (delta === null) return []
  const arrow = delta > 0 ? '⬆️' : delta < 0 ? '⬇️' : '➡️'
  return [
    delta === 0
      ? `${arrow} No change against the base branch (${baseline.toFixed(2)} libyears).`
      : `${arrow} **${signed(delta)} libyears** against the base branch (${baseline.toFixed(2)} → ${report.totalLibyears.toFixed(2)}).`,
    '',
  ]
}

// One row. Every field but the icons is echoed from the measured manifest, so
// it goes through cell(); a dep with no registry data has no numbers to show.
function depRow(d) {
  const icon = d.degraded ? '⚪' : ICON[d.quadrant]
  const drift = d.degraded || d.driftUnscored ? '—' : num(d.libyearsBehind)
  return `| ${icon} | \`${cell(d.name)}\` | ${cell(d.current)} | ${d.latest ? cell(d.latest) : '—'} | ${drift} | ${num(d.pulseYears)} | ${d.degraded ? '—' : num(d.viability)} |`
}

// Only the deps worth acting on. The full report is the JSON artifact; a
// summary that lists 400 healthy dependencies is one nobody reads.
function notableLines() {
  const notable = report.deps.filter((d) => d.degraded || d.quadrant !== 'healthy').sort(worstFirst)
  if (notable.length === 0) return []
  const out = ['| | Dependency | Current | Latest | Drift | Pulse | Viability |', '| --- | --- | --- | --- | --: | --: | --: |']
  for (const d of notable.slice(0, 30)) out.push(depRow(d))
  if (notable.length > 30) out.push('', `…and ${notable.length - 30} more in the JSON report.`)
  out.push('')
  return out
}

function summary() {
  const out = []
  out.push('## depwatch — drift × viability', '')
  out.push(
    exitCode === 0
      ? `**${report.totalLibyears.toFixed(2)} libyears** across ${plural(report.deps.length, 'dependency', 'dependencies')} — thresholds met.`
      : `**${report.totalLibyears.toFixed(2)} libyears** across ${plural(report.deps.length, 'dependency', 'dependencies')} — threshold breached.`,
    '',
  )

  out.push(...deltaLines())

  if (gateMessages.length > 0) {
    out.push('| | Gate |', '| --- | --- |')
    for (const m of gateMessages) out.push(`| ❌ | ${m} |`)
    out.push('')
  }

  out.push(
    `${ICON.replace} replace ${counts.replace} · ${ICON.upgrade} upgrade ${counts.upgrade} · ` +
      `${ICON.watch} watch ${counts.watch} · ${ICON.healthy} healthy ${counts.healthy}`,
    '',
  )

  out.push(...notableLines())

  if (degraded > 0) {
    out.push(`${plural(degraded, 'dependency', 'dependencies')} had no registry data and ${degraded === 1 ? 'was' : 'were'} not scored.`, '')
  }

  // The same upper-bound caveat the CLI table carries: a range gives its floor,
  // so an unresolved version overstates drift.
  const estimated = report.deps.filter((d) => !d.resolved && !d.degraded).length
  if (estimated > 0) {
    out.push(
      `Upper bound: ${estimated} of ${report.deps.length} versions came from a range, not a lock file — ` +
        'a range gives its floor, so the real drift is this or lower.',
      '',
    )
  }

  out.push(`<sub>${cell(report.file)} · ${cell(report.ecosystem)} · ${cell(report.generatedAt)}</sub>`)
  return out.join('\n')
}

setOutputs()

const body = summary()

if (process.env.GITHUB_STEP_SUMMARY && process.env.DEPWATCH_SUMMARY !== 'false') {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
}

// The first line is how the action finds the comment it posted last time, so it
// has to be stable across versions and invisible when rendered.
if (process.env.RUNNER_TEMP) {
  writeFileSync(`${process.env.RUNNER_TEMP}/depwatch-comment.md`, `${MARKER}\n\n${body}\n`)
}
