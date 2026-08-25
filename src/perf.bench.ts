// What a scan costs in time, for when you are optimising.
//
// Deliberately NOT wired into CI. A wall-clock number from a shared runner
// measures the runner, and a benchmark nobody trusts is a benchmark nobody
// reads. The tests that guard performance are the counting ones — the request
// budget in report.test.ts, the caps in the extension's cache.test.ts — because
// those are deterministic. This is the tool you reach for when one of them
// tells you something got worse and you want to know where the time went.
//
// `make bench` runs it; `make bench-chart` turns the same numbers into the
// figure in docs/performance.md. Nothing here touches the network.

import { bench, describe } from 'vitest'
import { analyse, type AnalyseCache, type CachedPackage, type DepReport } from './report.js'
import type { Manifest } from './manifest.js'
import { quadrantSVG } from './quadrant.js'
import { locateDeps } from '../extensions/vscode/src/locate.js'
import { reportHtml, type ReportView } from '../extensions/vscode/src/html.js'
import { tally } from './gates.js'

// --- fixtures ---

const DEPS = 200
const VERSIONS = 80

const iso = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).toISOString()

const versionsFor = (seed: number) =>
  Array.from({ length: VERSIONS }, (_, i) => ({
    version: `${Math.floor(i / 20)}.${i % 20}.0`,
    released: iso(2016 + Math.floor(i / 10), (i + seed) % 12),
  }))

const manifest: Manifest = {
  ecosystem: 'npm',
  file: 'package.json',
  deps: Array.from({ length: DEPS }, (_, i) => ({
    name: `@scope/package-${i}`,
    current: `${i % 4}.${i % 20}.0`,
    resolved: true,
  })),
}

// Every answer canned, so the loader is never called and no request is made.
const canned: Record<string, CachedPackage> = Object.fromEntries(
  manifest.deps.map((d, i) => [`npm:${d.name.toLowerCase()}`, { versions: versionsFor(i) }]),
)
const cache: AnalyseCache = { packages: async (key) => canned[key] }

const NOW = Date.parse('2026-01-01T00:00:00Z')

// One real report to render, rather than a hand-built one that could drift from
// what analyse actually produces.
const report = await analyse(manifest, { now: NOW, cache })

const view = (manifests: number): ReportView => ({
  manifests: Array.from({ length: manifests }, (_, i) => ({
    label: `packages/app-${i}/package.json`,
    path: `/repo/packages/app-${i}/package.json`,
    report,
    svg: quadrantSVG(report.deps),
    notes: [],
    counts: tally(report),
  })),
  failures: [],
  gates: [],
  gatesConfigured: false,
  thresholds: { staleLibyears: 1, riskyViability: 0.5 },
  deep: false,
  generatedAt: '2026-01-01 00:00',
})

const page = view(5)

// A v3 package-lock, the file the annotator has to index on every save.
const lockfile = JSON.stringify(
  {
    name: 'app',
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [
        `node_modules/@scope/package-${i}`,
        { version: `1.${i % 50}.0`, resolved: `https://registry.npmjs.org/@scope/package-${i}`, integrity: `sha512-${i}` },
      ]),
    ),
  },
  null,
  2,
)
const lockNames = report.deps.map((d: DepReport) => d.name)

// --- benches ---

describe('scan', () => {
  // Scoring 200 dependencies with every registry answer already in hand: the
  // drift maths, the timeline signals and the viability score, and nothing else.
  bench('analyse 200 deps, all cached', async () => {
    await analyse(manifest, { now: NOW, cache })
  })
})

describe('render', () => {
  // Once per manifest, every time the report is rebuilt.
  bench('quadrantSVG, 200 deps', () => {
    quadrantSVG(report.deps)
  })

  // The whole webview page. This is what used to run six times a second while a
  // scan was in flight, before the render throttle in panel.ts.
  bench('reportHtml, 5 manifests', () => {
    reportHtml(page)
  })
})

describe('annotate', () => {
  // Per save of a manifest, to place the squiggles.
  bench('locateDeps in a 2000-entry package-lock', () => {
    locateDeps(lockfile, 'package-lock.json', lockNames)
  })
})
