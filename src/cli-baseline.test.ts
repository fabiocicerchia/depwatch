import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBaseline, labelFor, parseFlags } from './cli.js'
import { serialise } from './baseline.js'
import type { DepReport, Quadrant, Report } from './report.js'
import { NO_SIGNALS } from './viability.js'

const dep = (name: string, quadrant: Quadrant, libyearsBehind: number): DepReport => ({
  name,
  current: '1.0.0',
  latest: '2.0.0',
  libyearsBehind,
  resolved: true,
  currentReleased: null,
  latestReleased: null,
  pulseYears: 0,
  viability: quadrant === 'replace' ? 0.1 : 1,
  quadrant,
  signals: { ...NO_SIGNALS },
})

const report = (deps: DepReport[]): Report => ({
  file: 'package.json',
  ecosystem: 'npm',
  generatedAt: '2026-01-01T00:00:00.000Z',
  totalLibyears: Math.round(deps.reduce((n, d) => n + d.libyearsBehind, 0) * 100) / 100,
  deps,
  worst: deps,
})

const scratch = () => mkdtempSync(join(tmpdir(), 'depwatch-cli-'))

describe('--write-baseline / --baseline flags', () => {
  it('takes an explicit filename', () => {
    expect(parseFlags(['--write-baseline', 'accepted.json']).writeBaseline).toBe('accepted.json')
    expect(parseFlags(['--baseline', 'accepted.json']).baseline).toBe('accepted.json')
  })

  it('falls back to the shared default filename', () => {
    expect(parseFlags(['--write-baseline']).writeBaseline).toBe('.depwatch-baseline.json')
  })

  it('does not swallow the next flag as a filename', () => {
    const f = parseFlags(['--write-baseline', '--json'])
    expect(f.writeBaseline).toBe('.depwatch-baseline.json')
    expect(f.json).toBe(true)
  })
})

describe('the label a baseline files a manifest under', () => {
  it('is relative to the baseline, so CI and the editor agree', () => {
    // The editor writes a workspace-relative label and puts the baseline at the
    // workspace root; `depwatch check` has to arrive at the same key.
    expect(labelFor('/repo/src/app/package.json', '/repo/.depwatch-baseline.json')).toBe(
      'src/app/package.json',
    )
    expect(labelFor('/repo/package.json', '/repo/.depwatch-baseline.json')).toBe('package.json')
  })

  it('always uses forward slashes', () => {
    expect(labelFor('/repo/a/b/package.json', '/repo/x.json')).not.toContain('\\')
  })
})

describe('applying a baseline', () => {
  const dir = scratch()
  const path = join(dir, '.depwatch-baseline.json')
  const manifest = join(dir, 'package.json')
  const original = report([dep('request', 'replace', 1.5), dep('lodash', 'upgrade', 9.2)])

  it('accepts everything it recorded', () => {
    writeFileSync(path, serialise([{ label: 'package.json', report: original }], '2026-01-01T00:00:00.000Z'))
    const out = applyBaseline(original, manifest, { baseline: path } as never)
    expect(out.accepted).toBe(2)
    expect(out.report.deps).toEqual([])
    expect(out.report.totalLibyears).toBe(0)
  })

  it('still reports a dependency that got worse', () => {
    const worse = report([dep('request', 'replace', 1.5), dep('lodash', 'upgrade', 11)])
    const out = applyBaseline(worse, manifest, { baseline: path } as never)
    expect(out.report.deps.map((d) => d.name)).toEqual(['lodash'])
  })

  it('still reports a dependency that fell to a worse quadrant', () => {
    const worse = report([dep('request', 'replace', 1.5), dep('lodash', 'replace', 9.2)])
    const out = applyBaseline(worse, manifest, { baseline: path } as never)
    expect(out.report.deps.map((d) => d.name)).toEqual(['lodash'])
  })

  it('still reports a dependency that was not there when it was written', () => {
    const grown = report([...original.deps, dep('left-pad', 'replace', 2)])
    const out = applyBaseline(grown, manifest, { baseline: path } as never)
    expect(out.report.deps.map((d) => d.name)).toEqual(['left-pad'])
  })

  it('errors on a named baseline that is not there', () => {
    // A typo in a flag should be an error, not a silent no-op.
    expect(() => applyBaseline(original, manifest, { baseline: join(dir, 'nope.json') } as never)).toThrow(
      /no such baseline/,
    )
  })

  it('reports everything when the default file is simply absent', () => {
    const out = applyBaseline(original, join(scratch(), 'package.json'), {} as never)
    expect(out.accepted).toBe(0)
    expect(out.report.deps).toHaveLength(2)
  })

  it('ignores a baseline it cannot understand rather than accepting nothing silently', () => {
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{"version": 99}')
    const out = applyBaseline(original, manifest, { baseline: broken } as never)
    expect(out.accepted).toBe(0)
    expect(out.report.deps).toHaveLength(2)
  })
})
