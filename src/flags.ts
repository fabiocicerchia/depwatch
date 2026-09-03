// The CLI's argument grammar: what each option is called, what shape its value
// has, and the one rule that spans two of them. Kept apart from cli.ts so the
// commands read as commands — the option tables change for a different reason
// than the code that runs them.

import { DEFAULT_BASELINE } from './baseline.js'
import { assertEcosystem, type SupportedEcosystem } from './manifest.js'
import { DEFAULT_THRESHOLDS, type Thresholds } from './report.js'

export interface Flags {
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

// Options as name → field tables rather than a twenty-case switch: adding one
// is a single entry, and the loop below stays the same size forever. Four
// tables because there are four shapes, not four kinds of option.
type SwitchKey = 'json' | 'deep' | 'ci' | 'labelAll' | 'noLock' | 'transitive'
type ValueKey = 'out' | 'baseline' | 'accepted'
type NumberKey = 'maxLibyears' | 'maxReplace' | 'maxLibyearsIncrease' | 'maxPoints'

const SWITCHES: Record<string, SwitchKey> = {
  '--json': 'json',
  '--deep': 'deep',
  '--ci': 'ci',
  '--label-all': 'labelAll',
  '--no-lock': 'noLock',
  '--transitive': 'transitive',
}

const VALUE_OPTIONS: Record<string, ValueKey> = {
  '--out': 'out',
  '--baseline': 'baseline',
  '--accepted': 'accepted',
}

const NUMBER_OPTIONS: Record<string, NumberKey> = {
  '--max-libyears': 'maxLibyears',
  '--max-replace': 'maxReplace',
  '--max-libyears-increase': 'maxLibyearsIncrease',
  '--max-points': 'maxPoints',
}

const THRESHOLD_OPTIONS: Record<string, keyof Thresholds> = {
  '--stale': 'staleLibyears',
  '--risky': 'riskyViability',
}

function valueAt(argv: string[], i: number, flag: string): string {
  const v = argv[i]
  if (v === undefined) throw new Error(`${flag} needs a value`)
  return v
}

function numberAt(argv: string[], i: number, flag: string): number {
  const n = Number(valueAt(argv, i, flag))
  if (!Number.isFinite(n)) throw new Error(`${flag} needs a number`)
  return n
}

// `--write-accepted`'s value is optional: the next argument is its value only
// when there is one and it is not itself a flag, so `--write-accepted --json`
// does not consume `--json` as a filename.
function isOptionalValue(next: string | undefined): boolean {
  return next !== undefined && next !== '' && !next.startsWith('-')
}

// A ratchet with nothing to ratchet against is a gate that silently never
// fires — the failure mode worth catching here rather than in a green build.
// The loop in parseFlags reads one option at a time; this is the rule
// spanning two of them.
function assertConsistent(f: Flags): void {
  if (f.maxLibyearsIncrease !== undefined && f.baseline === undefined) {
    throw new Error('--max-libyears-increase needs --baseline <file> to compare against')
  }
}

export function parseFlags(argv: string[]): Flags {
  const f: Flags = { json: false, deep: false, ci: false, labelAll: false, noLock: false, transitive: false, thresholds: { ...DEFAULT_THRESHOLDS } }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const flag = SWITCHES[a]
    const value = VALUE_OPTIONS[a]
    const number = NUMBER_OPTIONS[a]
    const threshold = THRESHOLD_OPTIONS[a]
    if (flag) f[flag] = true
    else if (value) f[value] = valueAt(argv, ++i, a)
    else if (number) f[number] = numberAt(argv, ++i, a)
    else if (threshold) f.thresholds[threshold] = numberAt(argv, ++i, a)
    else if (a === '--eco') f.eco = assertEcosystem(valueAt(argv, ++i, a))
    else if (a === '--write-accepted') f.writeAccepted = isOptionalValue(argv[i + 1]) ? valueAt(argv, ++i, a) : DEFAULT_BASELINE
    else throw new Error(`unknown option ${a}`)
  }
  assertConsistent(f)
  return f
}
