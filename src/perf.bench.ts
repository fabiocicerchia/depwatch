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

// Driven by tinybench directly rather than `vitest bench`: vitest 5 removed
// the benchmark API — no `bench` export, no `vitest bench` command — so the
// old form stopped type-checking and stopped running. tinybench is the engine
// vitest wrapped, so the numbers are the same measurement, and the JSON below
// keeps the shape scripts/bench-chart.mjs already reads.
import { writeFile } from "node:fs/promises";

import { Bench } from "tinybench";
import { analyse, type AnalyseCache, type CachedPackage, type DepReport } from "./report.js";
import type { Manifest } from "./manifest.js";
import { quadrantSVG } from "./quadrant.js";
import { locateDeps } from "../extensions/vscode/src/locate.js";
import { reportHtml, type ReportView } from "../extensions/vscode/src/html.js";
import { tally } from "./gates.js";

// --- fixtures ---

const DEPS = 200;
const VERSIONS = 80;

const iso = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).toISOString();

const versionsFor = (seed: number) =>
  Array.from({ length: VERSIONS }, (_, i) => ({
    version: `${Math.floor(i / 20)}.${i % 20}.0`,
    released: iso(2016 + Math.floor(i / 10), (i + seed) % 12),
  }));

const manifest: Manifest = {
  ecosystem: "npm",
  file: "package.json",
  deps: Array.from({ length: DEPS }, (_, i) => ({
    name: `@scope/package-${i}`,
    current: `${i % 4}.${i % 20}.0`,
    resolved: true,
  })),
};

// Every answer canned, so the loader is never called and no request is made.
const canned: Record<string, CachedPackage> = Object.fromEntries(
  manifest.deps.map((d, i) => [`npm:${d.name.toLowerCase()}`, { versions: versionsFor(i) }]),
);
const cache: AnalyseCache = { packages: async (key) => canned[key] };

const NOW = Date.parse("2026-01-01T00:00:00Z");

// One real report to render, rather than a hand-built one that could drift from
// what analyse actually produces.
const report = await analyse(manifest, { now: NOW, cache });

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
  generatedAt: "2026-01-01 00:00",
});

const page = view(5);

// A v3 package-lock, the file the annotator has to index on every save.
const lockfile = JSON.stringify(
  {
    name: "app",
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [
        `node_modules/@scope/package-${i}`,
        {
          version: `1.${i % 50}.0`,
          resolved: `https://registry.npmjs.org/@scope/package-${i}`,
          integrity: `sha512-${i}`,
        },
      ]),
    ),
  },
  null,
  2,
);
const lockNames = report.deps.map((d: DepReport) => d.name);

// --- benches ---

type Case = { name: string; fn: () => unknown | Promise<unknown> };

const groups: { name: string; cases: Case[] }[] = [
  {
    name: "scan",
    cases: [
      // Scoring 200 dependencies with every registry answer already in hand: the
      // drift maths, the timeline signals and the viability score, and nothing else.
      {
        name: "analyse 200 deps, all cached",
        fn: async () => {
          await analyse(manifest, { now: NOW, cache });
        },
      },
    ],
  },
  {
    name: "render",
    cases: [
      // Once per manifest, every time the report is rebuilt.
      { name: "quadrantSVG, 200 deps", fn: () => quadrantSVG(report.deps) },

      // The whole webview page. This is what used to run six times a second while
      // a scan was in flight, before the render throttle in panel.ts.
      { name: "reportHtml, 5 manifests", fn: () => reportHtml(page) },
    ],
  },
  {
    name: "annotate",
    cases: [
      // Per save of a manifest, to place the squiggles.
      {
        name: "locateDeps in a 2000-entry package-lock",
        fn: () => locateDeps(lockfile, "package-lock.json", lockNames),
      },
    ],
  },
];

// One Bench per group so the groups stay separable in the output, which is what
// the chart draws its rows from.
const rendered = [];
for (const group of groups) {
  const suite = new Bench();
  for (const item of group.cases) suite.add(item.name, item.fn);
  await suite.run();
  rendered.push({
    name: group.name,
    fullName: group.name,
    benchmarks: suite.tasks.map((task) => {
      // The result is a union — an aborted task carries no statistics. Narrow on
      // the field rather than on `state`, so a task that aborted *with*
      // statistics still reports the numbers it did collect.
      const stats = task.result && "latency" in task.result ? task.result.latency : undefined;
      return {
        name: task.name,
        // tinybench reports latency in milliseconds, which is the unit the
        // chart labels already assume.
        mean: stats?.mean ?? 0,
        min: stats?.min ?? 0,
        p99: stats?.p99 ?? 0,
      };
    }),
  });
}

const output = process.argv[2];
const json = JSON.stringify({ files: [{ groups: rendered }] }, null, 2);
if (output) {
  await writeFile(output, json);
  console.error(`${output}: ${rendered.reduce((n, g) => n + g.benchmarks.length, 0)} benchmarks`);
} else {
  for (const group of rendered) {
    console.log(group.name);
    for (const b of group.benchmarks) {
      console.log(`  ${b.name.padEnd(44)} ${b.mean.toFixed(3)} ms  (p99 ${b.p99.toFixed(3)})`);
    }
  }
}
