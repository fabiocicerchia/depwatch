import { describe, expect, it } from 'vitest'
import { gateFailures, tally } from './gates.js'
import type { DepReport, Report } from './report.js'
import { NO_SIGNALS } from './viability.js'

const dep = (over: Partial<DepReport>): DepReport => ({
  name: 'x',
  current: '1.0.0',
  latest: '2.0.0',
  libyearsBehind: 0,
  resolved: true,
  currentReleased: null,
  latestReleased: null,
  pulseYears: 0,
  viability: 1,
  quadrant: 'healthy',
  signals: { ...NO_SIGNALS },
  ...over,
})

const report = (deps: DepReport[]): Report => ({
  file: 'package.json',
  ecosystem: 'npm',
  generatedAt: '2026-01-01T00:00:00.000Z',
  totalLibyears: deps.reduce((sum, d) => sum + d.libyearsBehind, 0),
  deps,
  worst: [],
})

describe('tally', () => {
  it('counts each quadrant', () => {
    const counts = tally(
      report([
        dep({ name: 'a', quadrant: 'replace' }),
        dep({ name: 'b', quadrant: 'replace' }),
        dep({ name: 'c', quadrant: 'upgrade' }),
        dep({ name: 'd', quadrant: 'watch' }),
        dep({ name: 'e', quadrant: 'healthy' }),
      ]),
    )
    expect(counts).toEqual({ replace: 2, upgrade: 1, watch: 1, healthy: 1 })
  })

  // A dep the registry would not answer for carries quadrant 'healthy' as a
  // placeholder. Counting it as healthy would report data we do not have.
  it('leaves out deps that could not be scored', () => {
    const counts = tally(report([dep({ name: 'a', degraded: 'not found in registry' }), dep({ name: 'b' })]))
    expect(counts.healthy).toBe(1)
  })
})

describe('gateFailures', () => {
  it('passes when no gate is configured, however bad the report', () => {
    const r = report([dep({ libyearsBehind: 40, quadrant: 'replace' })])
    expect(gateFailures(r, {})).toEqual([])
  })

  it('fails on total drift above --max-libyears', () => {
    const r = report([dep({ libyearsBehind: 3.5 })])
    const fails = gateFailures(r, { maxLibyears: 2 })
    expect(fails).toHaveLength(1)
    expect(fails[0].gate).toBe('max-libyears')
    expect(fails[0].message).toContain('3.50 libyears')
  })

  // Strictly above: --max-libyears 2 is a budget of two, not of one.
  it('treats the threshold as a ceiling that may be reached', () => {
    expect(gateFailures(report([dep({ libyearsBehind: 2 })]), { maxLibyears: 2 })).toEqual([])
  })

  describe('the ratchet', () => {
    it('fails when drift grew by more than --max-libyears-increase', () => {
      const r = report([dep({ libyearsBehind: 3.52 })])
      const fails = gateFailures(r, { maxLibyearsIncrease: 0.25, baselineLibyears: 3.1 })
      expect(fails).toHaveLength(1)
      expect(fails[0].gate).toBe('max-libyears-increase')
      expect(fails[0].message).toContain('grew by 0.42 libyears')
      expect(fails[0].message).toContain('3.10 → 3.52')
    })

    it('passes when drift grew by exactly the allowance', () => {
      const r = report([dep({ libyearsBehind: 3.35 })])
      expect(gateFailures(r, { maxLibyearsIncrease: 0.25, baselineLibyears: 3.1 })).toEqual([])
    })

    // The point of the ratchet: a repository already 40 libyears behind is not
    // failed for its history, only for adding to it.
    it('passes on a large total that did not grow', () => {
      const r = report([dep({ libyearsBehind: 40 })])
      expect(gateFailures(r, { maxLibyearsIncrease: 0, baselineLibyears: 40 })).toEqual([])
    })

    it('passes when drift shrank', () => {
      const r = report([dep({ libyearsBehind: 1 })])
      expect(gateFailures(r, { maxLibyearsIncrease: 0, baselineLibyears: 9 })).toEqual([])
    })

    // 3.52 - 3.10 is 0.42000000000000004 in binary floating point. Comparing at
    // full precision would fail a ratchet of 0.42, and a ratchet of 0 would fail
    // on totals that only differ below the two decimals anything reports.
    it('compares at the two decimals every surface reports', () => {
      expect(gateFailures(report([dep({ libyearsBehind: 3.52 })]), { maxLibyearsIncrease: 0.42, baselineLibyears: 3.1 })).toEqual([])
      expect(gateFailures(report([dep({ libyearsBehind: 0.10000000000000002 })]), { maxLibyearsIncrease: 0, baselineLibyears: 0.1 })).toEqual([])
    })

    // Without a baseline there is nothing to ratchet against. Silently passing
    // is right here: the CLI rejects the flag combination up front, so a gate
    // that invented a baseline of 0 would only ever fire on a bug.
    it('is inert without a baseline', () => {
      expect(gateFailures(report([dep({ libyearsBehind: 40 })]), { maxLibyearsIncrease: 0 })).toEqual([])
    })
  })

  it('fails on too many deps in the replace quadrant', () => {
    const r = report([dep({ name: 'a', quadrant: 'replace' }), dep({ name: 'b', quadrant: 'replace' })])
    const fails = gateFailures(r, { maxReplace: 1 })
    expect(fails).toHaveLength(1)
    expect(fails[0].gate).toBe('max-replace')
  })

  it('reports every breached gate, not just the first', () => {
    const r = report([dep({ libyearsBehind: 9, quadrant: 'replace' })])
    expect(
      gateFailures(r, { maxLibyears: 1, maxReplace: 0, maxLibyearsIncrease: 0, baselineLibyears: 1 }).map((f) => f.gate),
    ).toEqual(['max-libyears', 'max-libyears-increase', 'max-replace'])
  })
})
