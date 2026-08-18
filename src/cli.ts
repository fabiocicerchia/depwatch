// depwatch CLI.
//
// The drift + pulse engine is imported from infra-toolbox
// (src/lib/libyear, src/lib/registry-client) via the @lib/* path mapping in
// tsconfig.json — resolved by esbuild at bundle time, never copied. What lives
// here is the second axis (viability), the quadrant, and the CLI itself.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { analyse, DEFAULT_THRESHOLDS, type DepReport, type Report, type Thresholds } from './report.js'
import { assertEcosystem, detectEcosystem, LOCK_FOR, parse, type SupportedEcosystem } from './manifest.js'
import { coverageLines, ecoIdList } from './ecosystems/registry.js'
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
  --stale <n>             libyears above which a dep counts as behind (default 1)
  --risky <n>             viability below which a dep counts as fading (default 0.5)
  --out <file>            write chart/JSON to a file instead of stdout
  --label-all             chart: label healthy points too
  --no-lock               read the manifest even when a lock file sits beside it
                          (drift then becomes an upper bound, not a measurement)
  --transitive            score the whole dependency tree from the lock file,
                          not just the dependencies you chose
  --max-points <n>        trend: how many commits to sample (default 12)

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
  deep: boolean
  ci: boolean
  labelAll: boolean
  eco?: SupportedEcosystem
  out?: string
  maxLibyears?: number
  maxReplace?: number
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
      case '--max-points': f.maxPoints = num(); break
      case '--stale': f.thresholds.staleLibyears = num(); break
      case '--risky': f.thresholds.riskyViability = num(); break
      default:
        throw new Error(`unknown option ${a}`)
    }
  }
  return f
}

// A manifest range gives its floor, not the installed version, so drift read
// from one is an upper bound. If the lock file is sitting right next to it, use
// that instead — silently reporting a worse number than reality is not a
// conservative default, it is a wrong one.
export function resolveInput(file: string, f: Flags): string {
  if (f.noLock) return file
  const eco = f.eco ?? detectEcosystem(file)
  if (!eco) return file
  const base = file.split('/').pop() ?? file
  if (LOCK_FOR[eco].includes(base)) return file // already a lock file
  for (const lock of LOCK_FOR[eco]) {
    const candidate = join(dirname(file), lock)
    if (existsSync(candidate)) return candidate
  }
  return file
}

async function loadReport(file: string, f: Flags): Promise<Report> {
  const input = resolveInput(file, f)
  const text = readFileSync(input, 'utf8')
  const manifest = parse(input, text, f.eco ?? detectEcosystem(input) ?? undefined, f.transitive)

  if (manifest.sbom && !f.json) {
    const skipped = Object.entries(manifest.sbom.skipped).sort((a, b) => b[1] - a[1])
    const parts = [`${manifest.sbom.format} SBOM: ${manifest.deps.length} scorable components`]
    if (manifest.sbom.scoped) parts.push(`direct only, of ${manifest.sbom.total} (--transitive for all)`)
    if (skipped.length > 0) {
      parts.push(`skipped ${skipped.map(([t, n]) => `${n} ${t}`).join(', ')} — no public registry this tool can query`)
    }
    console.error(`depwatch: ${parts.join('; ')}`)
  }

  // A lock file lists the whole transitive tree. libyear is a statement about
  // the dependencies you chose, so when the lock was found next to a manifest,
  // the manifest decides WHICH deps count and the lock decides WHICH VERSIONS
  // they are. Without this the number silently changes meaning — 14 direct deps
  // become 215 including transitives — and stops being comparable to anything.
  if (input !== file && !f.transitive && !manifest.sbom) {
    const direct = new Set(parse(file, readFileSync(file, 'utf8'), f.eco ?? undefined).deps.map((d) => d.name))
    manifest.deps = manifest.deps.filter((d) => direct.has(d.name))
    manifest.file = `${file} + ${input.split('/').pop()}`
  }
  if (input !== file && !f.json) {
    console.error(
      `depwatch: exact versions from ${input.split('/').pop()}${f.transitive ? ' (whole tree)' : ' (direct dependencies only; --transitive for the full tree)'}`,
    )
  }

  if (manifest.deps.length === 0) {
    throw new Error(
      manifest.sbom
        ? `${input}: the SBOM parsed, but none of its components come from a registry this tool can query`
        : `no dependencies found in ${input}`,
    )
  }
  return analyse(manifest, { deep: f.deep, thresholds: f.thresholds })
}

function emit(text: string, out?: string) {
  if (out) writeFileSync(out, text)
  else process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

// --- rendering ---

const QUAD_ORDER: Record<DepReport['quadrant'], number> = { replace: 0, upgrade: 1, watch: 2, healthy: 3 }

function table(r: Report, t: Thresholds): string {
  const rows = [...r.deps].sort(
    (a, b) => QUAD_ORDER[a.quadrant] - QUAD_ORDER[b.quadrant] || b.libyearsBehind - a.libyearsBehind || a.name.localeCompare(b.name),
  )
  const cols: [string, (d: DepReport) => string][] = [
    ['dep', (d) => d.name],
    ['current', (d) => d.current],
    ['eco', (d) => (d.ecosystem ? String(d.ecosystem) : '')],
    ['latest', (d) => d.latest ?? '—'],
    ['drift', (d) => (d.degraded ? '—' : d.libyearsBehind.toFixed(2))],
    ['pulse', (d) => (d.pulseYears === null ? '—' : d.pulseYears.toFixed(2))],
    ['viability', (d) => (d.degraded ? '—' : d.viability.toFixed(2))],
    ['quadrant', (d) => (d.degraded ? 'no data' : d.quadrant)],
  ]
  const widths = cols.map(([h, get]) => Math.max(h.length, ...rows.map((d) => get(d).length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()

  const out = [
    line(cols.map(([h]) => h)),
    line(widths.map((w) => '─'.repeat(w))),
    ...rows.map((d) => line(cols.map(([, get]) => get(d)))),
    '',
    `total drift: ${r.totalLibyears.toFixed(2)} libyears across ${r.deps.length} deps  (${r.ecosystem}, ${r.file})`,
  ]

  const counts = tally(r)
  out.push(`quadrants: replace ${counts.replace}  upgrade ${counts.upgrade}  watch ${counts.watch}  healthy ${counts.healthy}`)
  out.push(`thresholds: behind > ${t.staleLibyears} libyears, fading < ${t.riskyViability} viability`)

  const degraded = r.deps.filter((d) => d.degraded)
  if (degraded.length > 0) out.push(`${degraded.length} dep(s) had no registry data and were not scored`)

  const estimated = r.deps.filter((d) => !d.resolved && !d.degraded).length
  if (estimated > 0) {
    out.push(
      `upper bound: ${estimated} of ${r.deps.length} versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower`,
    )
  }
  return out.join('\n')
}

function tally(r: Report): Record<DepReport['quadrant'], number> {
  const counts: Record<DepReport['quadrant'], number> = { healthy: 0, upgrade: 0, watch: 0, replace: 0 }
  for (const d of r.deps) if (!d.degraded) counts[d.quadrant]++
  return counts
}

// Non-zero exit is the whole point of CI mode, so be explicit about why.
function ciFailures(r: Report, f: Flags): string[] {
  const fails: string[] = []
  if (f.maxLibyears !== undefined && r.totalLibyears > f.maxLibyears) {
    fails.push(`total drift ${r.totalLibyears.toFixed(2)} libyears exceeds --max-libyears ${f.maxLibyears}`)
  }
  const replace = tally(r).replace
  if (f.maxReplace !== undefined && replace > f.maxReplace) {
    fails.push(`${replace} deps in the replace quadrant exceeds --max-replace ${f.maxReplace}`)
  }
  return fails
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
      const r = await loadReport(file, f)
      emit(f.json ? JSON.stringify(r, null, 2) : table(r, f.thresholds), f.out)
      if (f.ci) {
        const fails = ciFailures(r, f)
        for (const msg of fails) console.error(`depwatch: ${msg}`)
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

export { main, parseFlags }
