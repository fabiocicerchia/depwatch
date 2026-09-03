// depwatch CLI.
//
// The drift + pulse engine is imported from infra-toolbox
// (src/lib/libyear, src/lib/registry-client) via the @lib/* path mapping in
// tsconfig.json — resolved by esbuild at bundle time, never copied. What lives
// here is the second axis (viability), the quadrant, and the CLI itself.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { acceptedIn, DEFAULT_BASELINE, parse as parseBaseline, serialise, withoutAccepted } from './baseline.js'
import { analyse, type Report } from './report.js'
import { type Flags, parseFlags } from './flags.js'
import { coverageLines, ecoIdList } from './ecosystems/registry.js'
import { gateFailures } from './gates.js'
import { loadManifest, resolveInput } from './input.js'
import { quadrantSVG } from './quadrant.js'
import { table, trendTable } from './render-text.js'
import { trend } from './trend.js'

const USAGE = `depwatch — dependency drift (libyears) × viability

  depwatch check <manifest> [options]     two-axis table
  depwatch chart <manifest> [options]     quadrant chart (SVG)
  depwatch trend <manifest> [options]     drift over the manifest's git history

Options
  --json                  machine-readable output
  --deep                  fetch maintainer/archived/last-commit signals
                          (extra requests; set GITHUB_TOKEN to avoid throttling)
  --eco <name>            force ecosystem: ${ecoIdList()}
  --ci                    exit non-zero when a threshold is breached
  --max-libyears <n>      CI: fail above this total drift
  --max-replace <n>       CI: fail above this many deps in the "replace" quadrant
  --max-libyears-increase <n>
                          CI: fail when drift grew more than this against
                          --baseline. The ratchet: gates a repo that is already
                          behind without failing it for debt it did not create
  --baseline <file>       a previous --json report to compare against
  --stale <n>             libyears above which a dep counts as behind (default 1)
  --risky <n>             viability below which a dep counts as fading (default 0.5)
  --out <file>            write chart/JSON to a file instead of stdout
  --label-all             chart: label healthy points too
  --no-lock               read the manifest even when a lock file sits beside it
                          (drift then becomes an upper bound, not a measurement)
  --transitive            score the whole dependency tree from the lock file,
                          not just the dependencies you chose
  --max-points <n>        trend: how many commits to sample (default 12)
  --accepted <file>       accept the findings recorded in <file>; only what got
                          worse since is reported (default: ./${DEFAULT_BASELINE}
                          when it is there)
  --write-accepted [file] record every current finding as accepted, and exit

Inputs, in order of accuracy:
  SBOM         CycloneDX or SPDX JSON — resolved versions, every ecosystem at once
  lock file    package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock,
               composer.lock, Gemfile.lock — resolved versions
  manifest     package.json, requirements.txt, Cargo.toml, composer.json —
               ranges only, so the result is an upper bound

Ecosystems (files recognised)
  ${coverageLines().join('\n  ')}`

// Where the input file gets resolved and read: src/input.ts, shared with every
// other surface so they cannot disagree about which file was measured.
export { resolveInput }

async function loadReport(file: string, f: Flags): Promise<Report> {
  const { manifest, notes } = loadManifest(file, { eco: f.eco, noLock: f.noLock, transitive: f.transitive })
  // stderr, so --json stays a clean pipe; suppressed entirely under --json
  // because a machine reading the JSON has the same facts in the payload.
  if (!f.json) for (const note of notes) console.error(`depwatch: ${note}`)
  return analyse(manifest, { deep: f.deep, thresholds: f.thresholds })
}

// A baseline is a report this same CLI wrote with --json, so the only field
// that matters is the total. Read narrowly: a truncated or half-written file
// should say so here, not compare as 0 and pass a ratchet that should have
// failed.
function readBaseline(file: string): number {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const total = (parsed as { totalLibyears?: unknown }).totalLibyears
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    throw new Error(`baseline ${file} has no usable totalLibyears`)
  }
  return total
}

function emit(text: string, out?: string) {
  if (out) writeFileSync(out, text)
  else process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

// --- the accepted baseline ---

/**
 * The manifest as the baseline names it: relative to the baseline file, with
 * forward slashes.
 *
 * The two callers disagree about paths otherwise — `depwatch check src/x/package.json`
 * in CI and the editor's workspace-relative label have to produce the same key,
 * or a baseline only works for whichever of them wrote it.
 */
function labelFor(manifest: string, baselinePath: string): string {
  const rel = relative(dirname(resolve(baselinePath)), resolve(manifest))
  return rel.split(/[\\/]/).join('/')
}

/**
 * The report as a baselined project should read it. An explicit --accepted must
 * exist; the default one is used when it happens to be there — a typo in a flag
 * should be an error, not a silent no-op.
 */
function applyBaseline(report: Report, file: string, f: Flags): { report: Report; accepted: number; from: string } {
  const path = f.accepted ?? DEFAULT_BASELINE
  if (f.accepted && !existsSync(path)) throw new Error(`no such baseline: ${path}`)
  if (!existsSync(path)) return { report, accepted: 0, from: path }

  const baseline = parseBaseline(readFileSync(path, 'utf8'))
  if (!baseline) {
    console.error(`depwatch: ${path} is not a baseline this version understands — ignoring it`)
    return { report, accepted: 0, from: path }
  }
  const accepted = acceptedIn(baseline, labelFor(file, path), report)
  return { report: withoutAccepted(report, accepted), accepted: accepted.size, from: path }
}

// --- commands ---

// `--write-accepted`: record today as the accepted set and stop. The count on
// stderr is what got accepted, not what is wrong, so it stays off stdout.
function writeAccepted(full: Report, file: string, path: string): number {
  const accepted = full.deps.filter((d) => !d.degraded && d.quadrant !== 'healthy').length
  writeFileSync(path, serialise([{ label: labelFor(file, path), report: full }], new Date().toISOString()))
  console.error(`depwatch: ${accepted} finding(s) accepted in ${path}`)
  return 0
}

function runGates(r: Report, f: Flags): number {
  const fails = gateFailures(r, {
    maxLibyears: f.maxLibyears,
    maxReplace: f.maxReplace,
    maxLibyearsIncrease: f.maxLibyearsIncrease,
    baselineLibyears: f.baseline === undefined ? undefined : readBaseline(f.baseline),
  })
  for (const { message } of fails) console.error(`depwatch: ${message}`)
  return fails.length > 0 ? 1 : 0
}

async function checkCommand(file: string, f: Flags): Promise<number> {
  const full = await loadReport(file, f)
  if (f.writeAccepted !== undefined) return writeAccepted(full, file, f.writeAccepted)

  const { report: r, accepted, from } = applyBaseline(full, file, f)
  emit(f.json ? JSON.stringify(r, null, 2) : table(r, f.thresholds), f.out)
  // stderr, so --json stays a clean pipe.
  if (accepted > 0) console.error(`depwatch: ${accepted} finding(s) accepted by ${from}`)
  return f.ci ? runGates(r, f) : 0
}

async function chartCommand(file: string, f: Flags): Promise<number> {
  const r = await loadReport(file, f)
  const svg = quadrantSVG(r.deps, {
    title: `${r.file} — drift × viability (${r.totalLibyears.toFixed(2)} libyears)`,
    thresholds: f.thresholds,
    labelAll: f.labelAll,
  })
  emit(svg, f.out)
  return 0
}

async function trendCommand(file: string, f: Flags): Promise<number> {
  const points = await trend(file, f.eco, { deep: f.deep, thresholds: f.thresholds, maxPoints: f.maxPoints })
  emit(f.json ? JSON.stringify(points, null, 2) : trendTable(points), f.out)
  return 0
}

const COMMANDS: Record<string, (file: string, f: Flags) => Promise<number>> = {
  check: checkCommand,
  chart: chartCommand,
  trend: trendCommand,
}

async function main(argv: string[]): Promise<number> {
  const [cmd, file, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    return cmd ? 0 : 2
  }
  if (!file) {
    console.error(USAGE)
    return 2
  }
  // Flags are parsed before the command is looked up, so an unknown option
  // reports itself even when the command is also wrong.
  const f = parseFlags(rest)
  const run = COMMANDS[cmd]
  if (!run) {
    console.error(USAGE)
    return 2
  }
  return run(file, f)
}

// Only run when executed, not when imported — otherwise a test that wants
// resolveInput would run the whole CLI as a side effect.
// Bundled by esbuild into dist/cli.js and run directly; under a test runner
// process.argv[1] is the runner, so importing this module stays side-effect free.
if (process.argv[1] && /(^|[/\\])(depwatch|cli\.js)$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((e: unknown) => {
      console.error('depwatch:', e instanceof Error ? e.message : e)
      process.exitCode = 2
    })
}

export { applyBaseline, labelFor, main }
