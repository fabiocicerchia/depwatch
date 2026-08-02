import { describe, expect, it } from 'vitest'
import { NO_SIGNALS, viabilityScore, type ViabilitySignals } from './viability.js'
import { timelineSignals } from './signals.js'
import { quadrant } from './report.js'

const s = (over: Partial<ViabilitySignals>): ViabilitySignals => ({ ...NO_SIGNALS, ...over })

// Calibration: synthetic profiles standing in for shapes we know are dead or
// alive. If a weight moves and these stop holding, the weight is wrong (or the
// case is — but decide that deliberately).
describe('viability calibration', () => {
  it('scores a thriving project high', () => {
    const score = viabilityScore(
      s({ lastReleaseAgeDays: 20, lastCommitAgeDays: 3, releaseCadenceDays: 30, maintainerCount: 6, openIssuesRatio: 0.2 }),
    )
    expect(score).toBeGreaterThan(0.9)
  })

  it('scores an abandoned-but-not-archived project low', () => {
    const score = viabilityScore(
      s({ lastReleaseAgeDays: 1500, lastCommitAgeDays: 1200, releaseCadenceDays: 800, maintainerCount: 1 }),
    )
    expect(score).toBeLessThan(0.1)
  })

  it('treats archived as terminal regardless of everything else', () => {
    const score = viabilityScore(
      s({ archived: true, lastReleaseAgeDays: 1, lastCommitAgeDays: 1, releaseCadenceDays: 14, maintainerCount: 20, hasFunding: true }),
    )
    expect(score).toBe(0)
  })

  it('puts a stable, slow-moving, well-staffed library in the middle, not the danger zone', () => {
    // Released a year ago, yearly cadence, three maintainers, recent commits:
    // the classic "finished" library. Should not read as dead.
    const score = viabilityScore(
      s({ lastReleaseAgeDays: 365, lastCommitAgeDays: 60, releaseCadenceDays: 365, maintainerCount: 3 }),
    )
    expect(score).toBeGreaterThan(0.5)
    expect(score).toBeLessThan(0.9)
  })

  it('is unknown, not dead, when nothing could be fetched', () => {
    expect(viabilityScore(s({}))).toBe(0.5)
  })

  it('renormalises rather than penalising missing signals', () => {
    // Pulse-only is the common case for registries with no repo metadata: a
    // fresh release must still score well on its own.
    expect(viabilityScore(s({ lastReleaseAgeDays: 10 }))).toBe(1)
    expect(viabilityScore(s({ lastReleaseAgeDays: 2000 }))).toBe(0)
  })

  it('lets funding nudge but never rescue', () => {
    const base = s({ lastReleaseAgeDays: 600, releaseCadenceDays: 400 })
    expect(viabilityScore({ ...base, hasFunding: true })).toBeGreaterThan(viabilityScore(base))
    expect(viabilityScore({ ...base, hasFunding: true })).toBeLessThanOrEqual(1)
  })

  it('penalises a bus factor of one', () => {
    const one = s({ lastReleaseAgeDays: 30, releaseCadenceDays: 60, maintainerCount: 1 })
    const many = s({ lastReleaseAgeDays: 30, releaseCadenceDays: 60, maintainerCount: 5 })
    expect(viabilityScore(one)).toBeLessThan(viabilityScore(many))
  })
})

describe('timelineSignals', () => {
  const day = 86_400_000
  const now = Date.parse('2026-01-01T00:00:00Z')
  const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString()

  it('derives pulse and median cadence from the version list alone', () => {
    const sig = timelineSignals(
      [
        { version: '1.0.0', released: at(120) },
        { version: '1.1.0', released: at(90) },
        { version: '1.2.0', released: at(60) },
        { version: '1.3.0', released: at(10) },
      ],
      now,
    )
    expect(sig.lastReleaseAgeDays).toBeCloseTo(10, 5)
    expect(sig.releaseCadenceDays).toBeCloseTo(30, 5) // gaps: 30, 30, 50
  })

  it('lets pulse outweigh a healthy historical cadence once a package stops', () => {
    const sig = timelineSignals(
      [
        { version: '1.0.0', released: at(2000) },
        { version: '1.1.0', released: at(1970) },
      ],
      now,
    )
    expect(sig.lastReleaseAgeDays).toBeCloseTo(1970, 5)
    expect(viabilityScore(sig)).toBeLessThan(0.35)
  })

  it('returns no signals when the registry has no dates', () => {
    expect(timelineSignals([{ version: '1.0.0', released: null }], now)).toEqual(NO_SIGNALS)
  })
})

describe('quadrant', () => {
  it('separates the four cases', () => {
    expect(quadrant(0.2, 0.9)).toBe('healthy')
    expect(quadrant(4, 0.9)).toBe('upgrade')
    expect(quadrant(0.2, 0.1)).toBe('watch') // current but fading — the one other tools miss
    expect(quadrant(4, 0.1)).toBe('replace')
  })

  it('honours custom thresholds', () => {
    expect(quadrant(2, 0.6, { staleLibyears: 3, riskyViability: 0.7 })).toBe('watch')
  })
})
