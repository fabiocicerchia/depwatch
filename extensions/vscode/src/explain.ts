// Saying why, in words.
//
// A squiggle under a dependency name is only worth having if hovering it
// explains itself. "viability 0.31" is not an explanation; "last release 3.4
// years ago, one maintainer, repository archived" is. Every number this shows
// comes from the report — nothing is inferred here that the engine did not
// measure.

import type { DepReport, Quadrant, Thresholds } from '../../../src/report.js'
import type { ViabilitySignals } from '../../../src/viability.js'

export interface QuadrantInfo {
  label: string
  action: string
  /** What the quadrant means, in one sentence. */
  blurb: string
}

export const QUADRANT: Record<Quadrant, QuadrantInfo> = {
  replace: {
    label: 'REPLACE',
    action: 'Plan a replacement',
    blurb: 'behind and unmaintained — the upgrade you need may never be written',
  },
  upgrade: {
    label: 'upgrade',
    action: 'Upgrade',
    blurb: 'behind but alive — the newer version exists, it is just work',
  },
  watch: {
    label: 'watch',
    action: 'Keep an eye on it',
    blurb: 'current but fading — nothing to upgrade to yet, and nobody obviously shipping one',
  },
  healthy: { label: 'healthy', action: 'Nothing to do', blurb: 'current, and maintained' },
}

export const ORDER: Quadrant[] = ['replace', 'upgrade', 'watch', 'healthy']

/** The one-line message that goes on the diagnostic. */
export function summarise(dep: DepReport, t: Thresholds): string {
  if (dep.degraded) return `${dep.name}: no registry data (${dep.degraded}) — not scored`
  const q = QUADRANT[dep.quadrant]
  const bits = [`${dep.libyearsBehind.toFixed(2)} libyears behind`, `viability ${dep.viability.toFixed(2)}`]
  if (dep.latest && dep.latest !== dep.current) bits.push(`${dep.current} → ${dep.latest}`)
  return `${dep.name}: ${q.label} — ${bits.join(', ')}. ${q.blurb}. ${thresholdNote(t)}`
}

const thresholdNote = (t: Thresholds) =>
  `Behind means over ${t.staleLibyears} libyears; fading means viability under ${t.riskyViability}.`

/**
 * Everything the report knows about one dependency, as the facts behind its
 * two numbers. Ordered worst-first: the reason someone should care goes at the
 * top of the tooltip, not the bottom.
 */
export function reasons(dep: DepReport): string[] {
  if (dep.degraded) return [`the registry did not answer for this package (${dep.degraded})`]

  const out: string[] = []
  const s = dep.signals

  if (s.archived) out.push('the repository is **archived** — the maintainer has said the project is over')
  if (dep.libyearsBehind > 0 && dep.currentReleased && dep.latestReleased) {
    out.push(
      `**${dep.libyearsBehind.toFixed(2)} libyears behind**: ${dep.current} shipped ${date(dep.currentReleased)}, ${dep.latest} shipped ${date(dep.latestReleased)}`,
    )
  } else if (dep.latest === dep.current) {
    out.push(`on the latest release (${dep.latest})`)
  }
  if (dep.pulseYears !== null) out.push(`last release ${years(dep.pulseYears)} ago`)
  if (s.lastCommitAgeDays !== null) out.push(`last commit ${days(s.lastCommitAgeDays)} ago`)
  if (s.releaseCadenceDays !== null) out.push(`ships about every ${days(s.releaseCadenceDays)}`)
  if (s.maintainerCount !== null) out.push(bus(s.maintainerCount))
  if (s.hasFunding) out.push('has a funding channel')
  if (!dep.resolved) {
    out.push('version read from a range, not a lock file — the real drift is this or lower')
  }
  if (isCheapTierOnly(s)) {
    out.push('scored from the release timeline only — run a deep scan for maintainers, archived status and last commit')
  }
  return out
}

const isCheapTierOnly = (s: ViabilitySignals) =>
  s.maintainerCount === null && s.lastCommitAgeDays === null && !s.archived

function bus(maintainers: number): string {
  if (maintainers <= 0) return 'no maintainers listed'
  if (maintainers === 1) return '**one maintainer** — one person is one bus'
  return `${maintainers} maintainers`
}

/** The hover, and the tree item's tooltip. Markdown. */
export function tooltip(dep: DepReport, t: Thresholds, ecosystem: string): string {
  const q = QUADRANT[dep.quadrant]
  const head = dep.degraded
    ? `**${dep.name}** — not scored`
    : `**${dep.name}** ${dep.current}${dep.latest && dep.latest !== dep.current ? ` → **${dep.latest}**` : ''}`

  const lines = [head, '', `${badge(dep)} · ${q.blurb}`, '']
  for (const reason of reasons(dep)) lines.push(`- ${reason}`)
  lines.push('', `_${thresholdNote(t)}_`)

  const url = registryUrl(dep.ecosystem ?? ecosystem, dep.name)
  if (url) lines.push('', `[${dep.name} on the registry](${url})`)
  return lines.join('\n')
}

function badge(dep: DepReport): string {
  if (dep.degraded) return '`no data`'
  return `\`${QUADRANT[dep.quadrant].label}\` drift **${dep.libyearsBehind.toFixed(2)}** ly · viability **${dep.viability.toFixed(2)}**`
}

export function registryUrl(ecosystem: string, name: string): string | null {
  switch (ecosystem) {
    case 'npm':
      return `https://www.npmjs.com/package/${name}`
    case 'pep440':
      return `https://pypi.org/project/${encodeURIComponent(name)}/`
    case 'cargo':
      return `https://crates.io/crates/${encodeURIComponent(name)}`
    case 'composer':
      return `https://packagist.org/packages/${name}`
    case 'rubygems':
      return `https://rubygems.org/gems/${encodeURIComponent(name)}`
    default:
      return null
  }
}

// --- units ---

export function years(n: number): string {
  if (n < 1 / 12) return 'less than a month'
  if (n < 1) return `${Math.max(1, Math.round(n * 12))} months`
  return `${n.toFixed(1)} years`
}

export function days(n: number): string {
  const whole = Math.round(n)
  if (whole < 45) return `${whole} days`
  if (whole < 365) return `${Math.round(whole / 30)} months`
  return `${(whole / 365.25).toFixed(1)} years`
}

const date = (iso: string) => iso.slice(0, 10)
