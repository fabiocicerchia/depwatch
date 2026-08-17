import { describe, expect, it } from 'vitest'
import type { DepReport, Quadrant, Report } from '../../../src/report.js'
import { NO_SIGNALS } from '../../../src/viability.js'
import { LENS_LABEL, LENSES, summaryDetail, summaryLabel, totalsOf } from './totals.js'

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

describe('totalsOf', () => {
  it('adds up drift and quadrants across every manifest in scope', () => {
    const t = totalsOf([
      report([dep('a', 'replace', 4.5), dep('b', 'upgrade', 2), dep('c', 'healthy')]),
      report([dep('d', 'watch'), dep('e', 'healthy')]),
    ])
    expect(t.libyears).toBeCloseTo(6.5, 2)
    expect(t.deps).toBe(5)
    expect(t.counts).toEqual({ replace: 1, upgrade: 1, watch: 1, healthy: 2 })
  })

  // "To address" is everything off the healthy quadrant. A dep the registry
  // would not answer for is unknown, not a to-do — counting it as work would
  // make a flaky registry look like a growing backlog.
  it('counts what is off the healthy quadrant, and leaves unknowns out of it', () => {
    const t = totalsOf([
      report([
        dep('a', 'replace', 3),
        dep('b', 'upgrade', 2),
        dep('c', 'watch'),
        dep('d', 'healthy'),
        dep('ghost', 'healthy', 0, 'not found in registry'),
      ]),
    ])
    expect(t.toAddress).toBe(3)
    expect(t.degraded).toBe(1)
    expect(t.counts.healthy).toBe(1) // the unknown is not counted as healthy either
    expect(t.deps).toBe(5)
  })

  it('is all zeroes for an empty scope', () => {
    const t = totalsOf([])
    expect(t).toEqual({
      libyears: 0,
      deps: 0,
      counts: { replace: 0, upgrade: 0, watch: 0, healthy: 0 },
      degraded: 0,
      toAddress: 0,
    })
  })
})

describe('summaryLabel', () => {
  it('leads with the drift and says how much of it is work', () => {
    const t = totalsOf([report([dep('a', 'replace', 4.5), dep('b', 'healthy')])])
    expect(summaryLabel(t)).toBe('4.50 libyears · 1 of 2 deps to address')
  })

  it('says so plainly when there is nothing to do', () => {
    const t = totalsOf([report([dep('a', 'healthy'), dep('b', 'healthy')])])
    expect(summaryLabel(t)).toBe('0.00 libyears · nothing to address')
  })

  it('counts one dependency in the singular', () => {
    expect(summaryLabel(totalsOf([report([dep('a', 'upgrade', 2)])]))).toContain('1 of 1 dep to address')
  })
})

describe('summaryDetail', () => {
  it('breaks the total down, worst quadrant first, skipping empty ones', () => {
    const t = totalsOf([
      report([dep('a', 'replace', 3), dep('b', 'replace', 1), dep('c', 'watch'), dep('d', 'healthy')]),
    ])
    expect(summaryDetail(t)).toBe('2 replace · 1 watch · 1 healthy')
  })

  it('reports unscorable deps separately from the quadrants', () => {
    const t = totalsOf([report([dep('a', 'upgrade', 2), dep('ghost', 'healthy', 0, 'registry HTTP 503')])])
    expect(summaryDetail(t)).toBe('1 upgrade · 1 no data')
  })
})

describe('lenses', () => {
  // The filter picker offers exactly these, so a missing label would be a blank
  // row in the quick pick.
  it('names every lens the filter can pick', () => {
    expect(LENSES).toHaveLength(5)
    for (const lens of LENSES) expect(LENS_LABEL[lens]).toBeTruthy()
  })
})
