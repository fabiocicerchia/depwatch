import { sharedVersions } from './shared.js'
import type { EcosystemDef } from './types.js'
import { type Dep, baseVersion } from './parse-util.js'
import { getJson } from './http.js'
import { repoUrlOf } from './meta.js'

const isDepTable = (segment: string | undefined) =>
  segment === 'dependencies' || segment === 'dev-dependencies' || segment === 'build-dependencies'

// Cargo states a version two ways — `serde = "1.0"` and
// `tokio = { version = "1.38", features = [...] }` — and both give the floor.
function cargoVersion(rhs: string): string | null {
  const version = rhs.startsWith('"') ? rhs.match(/^"([^"]+)"/)?.[1] : rhs.match(/version\s*=\s*"([^"]+)"/)?.[1]
  return version ? baseVersion(version) : null
}

// A `[dependencies]` header opens a section of `name = version` lines. A
// `[dependencies.serde]` header instead names one dependency on its own, whose
// version arrives on a later `version = "…"` line — so a blank placeholder goes
// in now, in manifest order, and the trailing filter drops it if none does.
function openTable(header: string, deps: Dep[]): boolean {
  const segments = header.replace(/^\[+|\]+$/g, '').split('.')
  const last = segments[segments.length - 1]
  if (isDepTable(last)) return true
  if (isDepTable(segments[segments.length - 2])) deps.push({ name: last, current: '', resolved: false })
  return false
}

// Enough TOML to read dependency tables. A full TOML parser would be a
// dependency for three line shapes; if Cargo manifests get exotic here, swap in
// the shared toml reader rather than growing this.
function parseCargoToml(text: string): Dep[] {
  const deps: Dep[] = []
  let inDeps = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    if (line.startsWith('[')) {
      inDeps = openTable(line, deps)
      continue
    }
    if (!inDeps) {
      const pending = deps[deps.length - 1]
      const v = pending && pending.current === '' ? line.match(/^version\s*=\s*"([^"]+)"/) : null
      if (v) pending.current = baseVersion(v[1]) ?? ''
      continue
    }
    const m = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/)
    if (!m) continue
    const current = cargoVersion(m[2])
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

export const cargo: EcosystemDef = {
  id: 'cargo',
  label: 'crates.io',
  purlTypes: ['cargo'],
  manifests: ['Cargo.toml'],
  locks: ['Cargo.lock'],
  parse: (text, base) => (base === 'Cargo.lock' ? parseCargoLock(text) : parseCargoToml(text)),
  fetchVersions: sharedVersions('cargo'),
  async fetchRepoMeta(name) {
    const d = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)
    return { repoUrl: repoUrlOf(d.crate?.repository), maintainerCount: null, hasFunding: false }
  },
}
