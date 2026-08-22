import { describe, expect, it } from 'vitest'
import type { DepReport, Quadrant, Report } from './report.js'
import { NO_SIGNALS } from './viability.js'
import { acceptedIn, type Baseline, parse, serialise, withoutAccepted } from './baseline.js'

const dep = (name: string, quadrant: Quadrant, libyearsBehind = 0, degraded?: string): DepReport => ({
  name,
  current: '1.0.0',
  latest: '2.0.0',
  libyearsBehind,
  resolved: true,
  currentReleased: null,
  latestReleased: null,
  pulseYears: 0,
  viability: 1,
  quadrant,
  signals: { ...NO_SIGNALS },
  ...(degraded ? { degraded } : {}),
})

const report = (deps: DepReport[]): Report => ({
  file: 'package.json',
  ecosystem: 'npm',
  generatedAt: '2026-01-01T00:00:00.000Z',
  totalLibyears: Math.round(deps.reduce((s, d) => s + d.libyearsBehind, 0) * 100) / 100,
  deps,
  worst: [],
})

const baselineOf = (scans: { label: string; report: Report }[]): Baseline =>
  parse(serialise(scans, '2026-01-01T00:00:00.000Z')) as Baseline

describe('serialise', () => {
  it('records the findings and their drift, worst first', () => {
    const text = serialise(
      [{ label: 'package.json', report: report([dep('a', 'replace', 4), dep('b', 'upgrade', 2)]) }],
      '2026-01-01T00:00:00.000Z',
    )
    const doc = JSON.parse(text)
    expect(doc.version).toBe(1)
    expect(doc.manifests['package.json']).toEqual({
      a: { ly: 4, q: 'replace' },
      b: { ly: 2, q: 'upgrade' },
    })
    expect(Object.keys(doc.manifests['package.json'])).toEqual(['a', 'b'])
    expect(text.endsWith('\n')).toBe(true) // a file people commit
  })

  // Accepting a healthy dependency would only make the file bigger; one that
  // stops being healthy is news, and news is the point.
  it('leaves out healthy and unscorable dependencies, and empty manifests', () => {
    const text = serialise(
      [
        { label: 'a/package.json', report: report([dep('ok', 'healthy'), dep('ghost', 'healthy', 0, 'no data')]) },
        { label: 'b/package.json', report: report([dep('bad', 'replace', 3)]) },
      ],
      '2026-01-01T00:00:00.000Z',
    )
    const doc = JSON.parse(text)
    expect(doc.manifests['a/package.json']).toBeUndefined()
    expect(Object.keys(doc.manifests['b/package.json'])).toEqual(['bad'])
  })
})

describe('parse', () => {
  it('reads back what it wrote', () => {
    const b = baselineOf([{ label: 'package.json', report: report([dep('a', 'upgrade', 2)]) }])
    expect(b.manifests['package.json'].a.ly).toBe(2)
  })

  // A hand-edited file that no longer parses must accept nothing rather than
  // silently accepting everything.
  it('rejects nonsense and unknown versions', () => {
    expect(parse('{')).toBeNull()
    expect(parse('{"version":99,"manifests":{}}')).toBeNull()
    expect(parse('{"version":1}')).toBeNull()
  })
})

describe('acceptedIn', () => {
  const base = baselineOf([
    { label: 'package.json', report: report([dep('drifter', 'upgrade', 2), dep('dying', 'watch', 0)]) },
  ])

  it('accepts a dependency that has not changed', () => {
    const now = report([dep('drifter', 'upgrade', 2), dep('dying', 'watch', 0)])
    expect([...acceptedIn(base, 'package.json', now)].sort()).toEqual(['drifter', 'dying'])
  })

  it('accepts one that improved', () => {
    const now = report([dep('drifter', 'upgrade', 0.5)])
    expect(acceptedIn(base, 'package.json', now).has('drifter')).toBe(true)
  })

  it('surfaces one that drifted further', () => {
    const now = report([dep('drifter', 'upgrade', 2.6)])
    expect(acceptedIn(base, 'package.json', now).has('drifter')).toBe(false)
  })

  // The case this tool exists for: same drift, but the maintainer walked away
  // since you accepted it.
  it('surfaces one that fell to a worse quadrant at the same drift', () => {
    const now = report([dep('dying', 'replace', 0)])
    expect(acceptedIn(base, 'package.json', now).has('dying')).toBe(false)
  })

  it('does not let rounding count as worse', () => {
    expect(acceptedIn(base, 'package.json', report([dep('drifter', 'upgrade', 2.004)])).has('drifter')).toBe(true)
  })

  it('accepts nothing for a manifest, or a dependency, it has never seen', () => {
    expect(acceptedIn(base, 'other/package.json', report([dep('drifter', 'upgrade', 2)])).size).toBe(0)
    expect(acceptedIn(base, 'package.json', report([dep('fresh', 'replace', 9)])).size).toBe(0)
    expect(acceptedIn(null, 'package.json', report([dep('drifter', 'upgrade', 2)])).size).toBe(0)
  })
})

describe('withoutAccepted', () => {
  it('drops the accepted deps and recomputes the total', () => {
    const r = withoutAccepted(report([dep('a', 'upgrade', 3), dep('b', 'replace', 1)]), new Set(['a']))
    expect(r.deps.map((d) => d.name)).toEqual(['b'])
    expect(r.totalLibyears).toBe(1)
  })

  // A fully baselined project should read as "nothing has got worse", not as a
  // project with no dependencies and a stale total.
  it('leaves a fully accepted manifest reading as zero', () => {
    const r = withoutAccepted(report([dep('a', 'upgrade', 3)]), new Set(['a']))
    expect(r.deps).toEqual([])
    expect(r.totalLibyears).toBe(0)
  })

  it('returns the same report when nothing is accepted', () => {
    const original = report([dep('a', 'upgrade', 3)])
    expect(withoutAccepted(original, new Set())).toBe(original)
  })
})
