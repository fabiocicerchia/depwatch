// depwatch CLI.
//
// The drift + pulse engine is imported from infra-toolbox
// (src/lib/libyear, src/lib/registry-client) via the @lib/* path mapping in
// tsconfig.json — resolved by esbuild at bundle time, never copied. What lives
// here is the second axis (viability), the quadrant, and the CLI itself.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { acceptedIn, DEFAULT_BASELINE, parse as parseBaseline, serialise, withoutAccepted } from './baseline.js'
import { analyse, compareDeps, DEFAULT_THRESHOLDS, REPORT_COLUMNS, type Report, type Thresholds } from './report.js'
import { assertEcosystem, type SupportedEcosystem } from './manifest.js'
import { coverageLines, ecoIdList } from './ecosystems/registry.js'
import { gateFailures, tally } from './gates.js'
import { loadManifest, resolveInput } from './input.js'
import { quadrantSVG } from './quadrant.js'
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

interface Flags {
  json: boolean
  accepted?: string
  writeAccepted?: string
  deep: boolean
  ci: boolean
  labelAll: boolean
  eco?: SupportedEcosystem
  out?: string
  maxLibyears?: number
  maxReplace?: number
  maxLibyearsIncrease?: number
  baseline?: string
  maxPoints?: number
  noLock: boolean
  transitive: boolean
  thresholds: Thresholds
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { json: false, deep: false, ci: false, labelAll: false, noLock: false, transitive: false, thresholds: { ...DEFAULT_THRESHOLDS } }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    const num = () => {
      const v = Number(value())
      if (!Number.isFinite(v)) throw new Error(`${a} needs a number`)
      return v
    }
    switch (a) {
      case '--json': f.json = true; break
      case '--deep': f.deep = true; break
      case '--ci': f.ci = true; break
      case '--label-all': f.labelAll = true; break
      case '--no-lock': f.noLock = true; break
      case '--transitive': f.transitive = true; break
      case '--eco': f.eco = assertEcosystem(value()); break
      case '--out': f.out = value(); break
      case '--max-libyears': f.maxLibyears = num(); break
      case '--max-replace': f.maxReplace = num(); break
      case '--max-libyears-increase': f.maxLibyearsIncrease = num(); break
      case '--baseline': f.baseline = value(); break
      case '--max-points': f.maxPoints = num(); break
      case '--accepted': f.accepted = value(); break
      // The value is optional, so only take the next argument when there is one
      // that is not itself a flag — `--write-accepted --json` must not consume
      // `--json` as a filename.
      case '--write-accepted':
        f.writeAccepted = argv[i + 1] && !argv[i + 1].startsWith('-') ? value() : DEFAULT_BASELINE
        break
      case '--stale': f.thresholds.staleLibyears = num(); break
      case '--risky': f.thresholds.riskyViability = num(); break
      default:
        throw new Error(`unknown option ${a}`)
    }
  }
  // A ratchet with nothing to ratchet against is a gate that silently never
  // fires — the failure mode worth catching here rather than in a green build.
  if (f.maxLibyearsIncrease !== undefined && f.baseline === undefined) {
    throw new Error('--max-libyears-increase needs --baseline <file> to compare against')
  }
  return f
}

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

// --- rendering ---

// One row of the text table: each cell padded to its column's width, with the
// trailing padding of the last cell trimmed so lines have no invisible tail.
function padRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
}

function table(r: Report, t: Thresholds): string {
  const rows = [...r.deps].sort(compareDeps)
  const widths = REPORT_COLUMNS.map((c) => Math.max(c.header.length, ...rows.map((d) => c.of(d).length)))

  const out = [
    padRow(
      REPORT_COLUMNS.map((c) => c.header),
      widths,
    ),
    padRow(
      widths.map((w) => '─'.repeat(w)),
      widths,
    ),
    ...rows.map((d) => padRow(REPORT_COLUMNS.map((c) => c.of(d)), widths)),
    '',
    `total drift: ${r.totalLibyears.toFixed(2)} libyears across ${r.deps.length} deps  (${r.ecosystem}, ${r.file})`,
  ]

  const counts = tally(r)
  out.push(`quadrants: replace ${counts.replace}  upgrade ${counts.upgrade}  watch ${counts.watch}  healthy ${counts.healthy}`)
  out.push(`thresholds: behind > ${t.staleLibyears} libyears, fading < ${t.riskyViability} viability`)

  const degraded = r.deps.filter((d) => d.degraded)
  if (degraded.length > 0) out.push(`${degraded.length} dep(s) had no registry data and were not scored`)

  const pulseOnly = r.deps.filter((d) => d.driftUnscored)
  if (pulseOnly.length > 0)
    out.push(`${pulseOnly.length} dep(s) scored on pulse and viability only — no comparable version series (drift shown as —)`)

  const estimated = r.deps.filter((d) => !d.resolved && !d.degraded).length
  if (estimated > 0) {
    out.push(
      `upper bound: ${estimated} of ${r.deps.length} versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower`,
    )
  }
  return out.join('\n')
}

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
  const f = parseFlags(rest)

  switch (cmd) {
    case 'check': {
      const full = await loadReport(file, f)

      if (f.writeAccepted !== undefined) {
        const path = f.writeAccepted
        const accepted = full.deps.filter((d) => !d.degraded && d.quadrant !== 'healthy').length
        writeFileSync(path, serialise([{ label: labelFor(file, path), report: full }], new Date().toISOString()))
        console.error(`depwatch: ${accepted} finding(s) accepted in ${path}`)
        return 0
      }

      const { report: r, accepted, from } = applyBaseline(full, file, f)
      emit(f.json ? JSON.stringify(r, null, 2) : table(r, f.thresholds), f.out)
      // stderr, so --json stays a clean pipe.
      if (accepted > 0) console.error(`depwatch: ${accepted} finding(s) accepted by ${from}`)
      if (f.ci) {
        const fails = gateFailures(r, {
          maxLibyears: f.maxLibyears,
          maxReplace: f.maxReplace,
          maxLibyearsIncrease: f.maxLibyearsIncrease,
          baselineLibyears: f.baseline === undefined ? undefined : readBaseline(f.baseline),
        })
        for (const { message } of fails) console.error(`depwatch: ${message}`)
        return fails.length > 0 ? 1 : 0
      }
      return 0
    }
    case 'chart': {
      const r = await loadReport(file, f)
      const svg = quadrantSVG(r.deps, {
        title: `${r.file} — drift × viability (${r.totalLibyears.toFixed(2)} libyears)`,
        thresholds: f.thresholds,
        labelAll: f.labelAll,
      })
      emit(svg, f.out)
      return 0
    }
    case 'trend': {
      const points = await trend(file, f.eco, { deep: f.deep, thresholds: f.thresholds, maxPoints: f.maxPoints })
      if (f.json) {
        emit(JSON.stringify(points, null, 2), f.out)
      } else {
        const lines = points.map(
          (p) =>
            `${p.date.slice(0, 10)}  ${p.commit}  ${p.totalLibyears.toFixed(2).padStart(8)} libyears  ${String(p.deps).padStart(4)} deps  ${p.replace} replace`,
        )
        const first = points[0]
        const last = points[points.length - 1]
        if (first && last && points.length > 1) {
          const delta = last.totalLibyears - first.totalLibyears
          lines.push('', `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} libyears over ${points.length} sampled commits`)
        }
        emit(lines.join('\n'), f.out)
      }
      return 0
    }
    default:
      console.error(USAGE)
      return 2
  }
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

export { applyBaseline, labelFor, main, parseFlags }
