import { describe, expect, it } from 'vitest'
import type { DepReport, Report } from '../../../src/report.js'
import { NO_SIGNALS, type ViabilitySignals } from '../../../src/viability.js'
import { reasons, summarise, tooltip } from './explain.js'
import { reportHtml, type ReportView, trendHtml } from './html.js'

const dep = (over: Partial<DepReport> = {}, signals: Partial<ViabilitySignals> = {}): DepReport => ({
  name: 'left-pad',
  current: '1.0.0',
  latest: '2.0.0',
  libyearsBehind: 2.5,
  resolved: true,
  currentReleased: '2021-01-01T00:00:00Z',
  latestReleased: '2023-07-01T00:00:00Z',
  pulseYears: 2.5,
  viability: 0.3,
  quadrant: 'replace',
  signals: { ...NO_SIGNALS, ...signals },
  ...over,
})

const thresholds = { staleLibyears: 1, riskyViability: 0.5 }

const view = (deps: DepReport[], over: Partial<ReportView> = {}): ReportView => {
  const report: Report = {
    file: 'package.json',
    ecosystem: 'npm',
    generatedAt: '2026-01-01T00:00:00.000Z',
    totalLibyears: deps.reduce((s, d) => s + d.libyearsBehind, 0),
    deps,
    worst: [],
  }
  return {
    manifests: [
      {
        label: 'package.json',
        path: '/repo/package.json',
        report,
        svg: '<svg></svg>',
        notes: [],
        counts: { replace: deps.length, upgrade: 0, watch: 0, healthy: 0 },
      },
    ],
    failures: [],
    gates: [],
    gatesConfigured: false,
    thresholds,
    deep: false,
    generatedAt: '2026-01-01 00:00',
    ...over,
  }
}

describe('summarise', () => {
  it('names the quadrant, both numbers and the upgrade', () => {
    const line = summarise(dep(), thresholds)
    expect(line).toContain('left-pad')
    expect(line).toContain('REPLACE')
    expect(line).toContain('2.50 libyears behind')
    expect(line).toContain('viability 0.30')
    expect(line).toContain('1.0.0 → 2.0.0')
  })

  // Unknown is not dead: the message has to say which one this is.
  it('says a degraded dep was not scored rather than scoring it', () => {
    const line = summarise(dep({ degraded: 'not found in registry' }), thresholds)
    expect(line).toContain('no registry data')
    expect(line).not.toContain('REPLACE')
  })
})

describe('reasons', () => {
  it('turns the signals into facts, worst first', () => {
    const out = reasons(
      dep({}, { archived: true, maintainerCount: 1, lastCommitAgeDays: 900, releaseCadenceDays: 400 }),
    )
    expect(out[0]).toContain('archived')
    expect(out.join(' ')).toContain('one maintainer')
    expect(out.join(' ')).toContain('2.5 years ago') // last commit
    expect(out.join(' ')).toContain('2.50 libyears behind')
  })

  it('explains that a range-derived version is an upper bound', () => {
    expect(reasons(dep({ resolved: false })).join(' ')).toContain('range')
  })

  // The cheap tier is the default, and a tooltip that silently omits maintainer
  // data reads as "there is one maintainer-shaped problem here", not "not asked".
  it('says when only the release timeline was available', () => {
    expect(reasons(dep()).join(' ')).toContain('deep scan')
    expect(reasons(dep({}, { maintainerCount: 4 })).join(' ')).not.toContain('deep scan')
  })

  it('says only that the registry did not answer, for a degraded dep', () => {
    expect(reasons(dep({ degraded: 'registry HTTP 503' }))).toEqual([
      'the registry did not answer for this package (registry HTTP 503)',
    ])
  })
})

describe('tooltip', () => {
  it('links to the registry the dep came from', () => {
    expect(tooltip(dep(), thresholds, 'npm')).toContain('https://www.npmjs.com/package/left-pad')
    expect(tooltip(dep({ name: 'serde' }), thresholds, 'cargo')).toContain('https://crates.io/crates/serde')
  })
})

describe('reportHtml', () => {
  it('renders the totals, the chart and a row per dep', () => {
    const html = reportHtml(view([dep(), dep({ name: 'ok', quadrant: 'healthy', libyearsBehind: 0, viability: 1 })]))
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('depwatch')
    expect(html).toContain('<svg></svg>')
    expect(html).toContain('left-pad')
    expect(html).toContain('2.50') // total drift
    expect(html).toContain('data-dep="ok"')
  })

  // Package names come from a registry; they are not to be trusted as markup.
  it('escapes anything that came from a package name', () => {
    const html = reportHtml(view([dep({ name: '<script>alert(1)</script>' })]))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  // A webview gets a nonce, a CSP and the click-to-reveal script; a file must
  // get none of those, because there is nothing there to talk to.
  it('only scripts the page when rendered into a webview', () => {
    const standalone = reportHtml(view([dep()]))
    expect(standalone).not.toContain('<script')
    expect(standalone).not.toContain('Content-Security-Policy')

    const webview = reportHtml(view([dep()]), { nonce: 'abc123', cspSource: 'vscode-resource:' })
    expect(webview).toContain('nonce="abc123"')
    expect(webview).toContain("script-src 'nonce-abc123'")
    expect(webview).toContain('acquireVsCodeApi')
  })

  // In the editor the report is the editor's theme; exported, it is depwatch's.
  it('themes itself from VS Code inside a webview and from the docs palette outside', () => {
    expect(reportHtml(view([dep()]), { nonce: 'n' })).toContain('--vscode-editor-background')
    expect(reportHtml(view([dep()]))).not.toContain('--vscode-editor-background')
  })

  it('reports gate failures when gates are configured', () => {
    const html = reportHtml(
      view([dep()], {
        gatesConfigured: true,
        gates: [{ gate: 'max-libyears', message: 'package.json: total drift 2.50 libyears exceeds --max-libyears 1' }],
      }),
    )
    expect(html).toContain('gate(s) failing')
    expect(html).toContain('exceeds --max-libyears 1')
  })

  it('says nothing about gates when none are set', () => {
    const html = reportHtml(view([dep()]))
    expect(html).not.toContain('Gates pass')
    expect(html).not.toContain('gate(s) failing')
  })

  it('lists manifests that could not be scanned', () => {
    const html = reportHtml(view([dep()], { failures: [{ label: 'api/package.json', message: 'no dependencies found' }] }))
    expect(html).toContain('api/package.json')
    expect(html).toContain('no dependencies found')
  })
})

describe('trendHtml', () => {
  const points = [
    { commit: 'aaaaaaaa', date: '2024-01-01T00:00:00Z', totalLibyears: 1, deps: 4, replace: 0 },
    { commit: 'bbbbbbbb', date: '2025-01-01T00:00:00Z', totalLibyears: 3, deps: 5, replace: 2 },
  ]

  // The same rows `depwatch trend` prints, rather than a second chart type.
  it('lists a row per sampled commit and says which way it went', () => {
    const html = trendHtml('package.json', points)
    expect(html).toContain('2024-01-01')
    expect(html).toContain('aaaaaaaa')
    expect(html).toContain('+2.00 libyears over 2 sampled commits')
    expect(html).toContain('drifting further behind')
  })

  it('says so when there is no history', () => {
    expect(trendHtml('package.json', [])).toContain('No commits touched this file')
  })
})
