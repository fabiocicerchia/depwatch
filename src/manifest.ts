// Manifest detection and parsing across the five ecosystems the shared
// registry-client can reach. npm and PyPI parsing already exist in the
// infra-toolbox libyear engine, so they are delegated, not rewritten.

import type { Ecosystem } from '@lib/semver'
import { detectKind, parseManifest as parseShared, type Dep } from '@lib/libyear/engine'
import { detectSbom, directOnly, parseSbom, type SbomParse } from './sbom.js'

export type SupportedEcosystem = Extract<Ecosystem, 'npm' | 'pep440' | 'cargo' | 'composer' | 'rubygems'>

// Lock files state what is installed; manifests state a range whose floor gets
// read as the version. Preferring the lock is the difference between measuring
// drift and over-reporting it.
export const LOCK_FILES: Record<string, SupportedEcosystem> = {
  'package-lock.json': 'npm',
  'yarn.lock': 'npm',
  'pnpm-lock.yaml': 'npm',
  'Cargo.lock': 'cargo',
  'composer.lock': 'composer',
  'Gemfile.lock': 'rubygems',
}

// The lock file that belongs beside a given manifest, in preference order.
export const LOCK_FOR: Record<SupportedEcosystem, string[]> = {
  npm: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
  pep440: [],
  cargo: ['Cargo.lock'],
  composer: ['composer.lock'],
  rubygems: ['Gemfile.lock'],
}

export const SUPPORTED_ECOSYSTEMS: SupportedEcosystem[] = ['npm', 'pep440', 'cargo', 'composer', 'rubygems']

// The CLI takes --eco from the command line, where a typo is a string like any
// other. Without this the value would be cast straight to the union type and
// reach a switch that matches no case, producing an empty dependency list —
// "your manifest is clean" is the worst possible answer to a misspelt flag.
export function assertEcosystem(value: string): SupportedEcosystem {
  if ((SUPPORTED_ECOSYSTEMS as string[]).includes(value)) return value as SupportedEcosystem
  throw new Error(`unsupported ecosystem "${value}" (want one of: ${SUPPORTED_ECOSYSTEMS.join(', ')})`)
}

export interface Manifest {
  ecosystem: SupportedEcosystem
  file: string
  deps: Dep[]
  // Present when the input was an SBOM: which components were skipped for want
  // of a reachable registry, and whether the graph narrowed it to direct deps.
  sbom?: { format: string; skipped: Record<string, number>; total: number; scoped: boolean }
}

// Filenames are the reliable signal; content sniffing is not needed because
// every ecosystem here has a conventional manifest name.
export function detectEcosystem(file: string): SupportedEcosystem | null {
  const base = file.split('/').pop() ?? file
  if (LOCK_FILES[base]) return LOCK_FILES[base]
  if (base === 'package.json') return 'npm'
  if (base === 'requirements.txt' || base.startsWith('requirements')) return 'pep440'
  if (base === 'Cargo.toml') return 'cargo'
  if (base === 'composer.json') return 'composer'
  if (base === 'Gemfile.lock') return 'rubygems'
  return null
}

export function parse(file: string, text: string, ecosystem?: SupportedEcosystem, transitive = false): Manifest {
  // Detected from content: an SBOM has no conventional filename, and bom.json
  // would otherwise be read as a package.json and yield nothing at all.
  if (detectSbom(text)) {
    const parsed = parseSbom(text) as SbomParse
    const chosen = transitive ? parsed.components : directOnly(parsed)
    return {
      // Nominal only — each dep carries its own ecosystem.
      ecosystem: chosen[0]?.ecosystem ?? 'npm',
      file,
      deps: chosen,
      sbom: {
        format: parsed.format,
        skipped: parsed.skipped,
        total: parsed.components.length,
        scoped: chosen.length < parsed.components.length,
      },
    }
  }

  const eco = ecosystem ?? detectEcosystem(file)
  if (!eco)
    throw new Error(`unrecognised input: ${file} (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)`)
  return { ecosystem: eco, file, deps: parseFor(eco, text, file) }
}

function parseFor(eco: SupportedEcosystem, text: string, file = ''): Dep[] {
  const base = file.split('/').pop() ?? file
  switch (eco) {
    case 'npm': {
      // Detect rather than trust the filename: a lock read as a manifest (or
      // the reverse) produces a wrong number with no error.
      const kind = detectKind(text)
      if (kind === 'package-lock' || kind === 'yarn-lock' || kind === 'pnpm-lock') return parseShared(text, kind)
      if (base === 'package-lock.json') return parseShared(text, 'package-lock')
      if (base === 'yarn.lock') return parseShared(text, 'yarn-lock')
      if (base === 'pnpm-lock.yaml') return parseShared(text, 'pnpm-lock')
      return parseShared(text, 'npm')
    }
    case 'pep440':
      return parseShared(text, 'pep440')
    case 'cargo':
      return base === 'Cargo.lock' ? parseCargoLock(text) : parseCargoToml(text)
    case 'composer':
      return base === 'composer.lock' ? parseComposerLock(text) : parseComposerJson(text)
    case 'rubygems':
      return parseGemfileLock(text)
  }
}

const baseVersion = (range: string): string | null => range.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null

const isDepTable = (segment: string | undefined) =>
  segment === 'dependencies' || segment === 'dev-dependencies' || segment === 'build-dependencies'

// Enough TOML to read dependency tables. A full TOML parser would be a
// dependency for three line shapes; if Cargo manifests get exotic here, swap in
// a real parser rather than growing this.
function parseCargoToml(text: string): Dep[] {
  const deps: Dep[] = []
  let inDeps = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    if (line.startsWith('[')) {
      // [dependencies], [dev-dependencies], [target.'cfg(...)'.dependencies],
      // and the [dependencies.foo] form that names the crate in the header.
      const segments = line.replace(/^\[+|\]+$/g, '').split('.')
      const last = segments[segments.length - 1]
      const prev = segments[segments.length - 2]
      inDeps = isDepTable(last)
      if (!inDeps && isDepTable(prev)) deps.push({ name: last, current: '', resolved: false })
      continue
    }
    if (!inDeps) {
      // Inside a [dependencies.foo] table the version line still matters.
      const last = deps[deps.length - 1]
      const v = last && last.current === '' ? line.match(/^version\s*=\s*"([^"]+)"/) : null
      if (v) last.current = baseVersion(v[1]) ?? ''
      continue
    }
    const m = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/)
    if (!m) continue
    const rhs = m[2]
    const version = rhs.startsWith('"') ? rhs.match(/^"([^"]+)"/)?.[1] : rhs.match(/version\s*=\s*"([^"]+)"/)?.[1]
    const current = version ? baseVersion(version) : null
    if (current) deps.push({ name: m[1], current, resolved: false })
  }
  return deps.filter((d) => d.current !== '')
}

// Cargo.lock is TOML with [[package]] blocks: name and version, both exact.
function parseCargoLock(text: string): Dep[] {
  const deps: Dep[] = []
  let name: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '[[package]]') {
      name = null
      continue
    }
    const n = line.match(/^name\s*=\s*"([^"]+)"/)
    if (n) {
      name = n[1]
      continue
    }
    const v = line.match(/^version\s*=\s*"([^"]+)"/)
    if (v && name) {
      deps.push({ name, current: v[1], resolved: true })
      name = null
    }
  }
  return deps
}

// composer.lock lists resolved packages under "packages" and "packages-dev".
function parseComposerLock(text: string): Dep[] {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const deps: Dep[] = []
  for (const section of ['packages', 'packages-dev']) {
    for (const pkg of json?.[section] ?? []) {
      if (pkg?.name && pkg?.version) {
        deps.push({ name: pkg.name, current: String(pkg.version).replace(/^v/, ''), resolved: true })
      }
    }
  }
  return deps
}

function parseComposerJson(text: string): Dep[] {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const deps: Dep[] = []
  for (const section of ['require', 'require-dev']) {
    for (const [name, range] of Object.entries<unknown>(json?.[section] ?? {})) {
      // php / ext-* are platform requirements, not packages on Packagist.
      if (!name.includes('/')) continue
      const current = baseVersion(String(range))
      if (current) deps.push({ name, current, resolved: false })
    }
  }
  return deps
}

// Gemfile.lock rather than Gemfile: the lock pins exact versions, which is what
// drift needs. Spec lines are indented four spaces; their dependency lines six.
function parseGemfileLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let inSpecs = false
  for (const raw of text.split('\n')) {
    if (/^\s{2}specs:\s*$/.test(raw)) {
      inSpecs = true
      continue
    }
    if (raw.trim() && !raw.startsWith(' ')) {
      inSpecs = false
      continue
    }
    if (!inSpecs) continue
    const m = raw.match(/^\s{4}([A-Za-z0-9._-]+) \(([^)]+)\)$/)
    if (!m) continue
    const current = baseVersion(m[2])
    if (current && !seen.has(m[1])) {
      seen.add(m[1])
      deps.push({ name: m[1], current, resolved: true }) // a lock file: exact
    }
  }
  return deps
}
