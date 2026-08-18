// conda — anaconda.org. environment.yml states specs; conda-lock.yml pins exact
// versions. conda is NOT PyPI: packages come from channels (conda-forge by
// default). Built against the documented anaconda.org API shape (files[].version
// / upload_time); verify where api.anaconda.org is reachable.
//
// conda versions carry a PEP-440-ish epoch (`1!1.2.3`) the shared comparator
// does not understand, so this def supplies its own ops.

import { compareVersions as sharedCompare, isPrerelease as sharedPre } from '../lib/semver.js'
import type { EcosystemDef, VersionOps } from './types.js'
import { getJson } from './http.js'
import { parseYaml } from './yaml.js'
import { type Dep, baseVersion } from './parse-util.js'
import { toIso } from './meta.js'

// "conda-forge::numpy" -> { channel, name }; bare name defaults to conda-forge.
function splitChannel(spec: string): { channel: string; name: string } {
  const at = spec.indexOf('::')
  return at === -1 ? { channel: 'conda-forge', name: spec } : { channel: spec.slice(0, at), name: spec.slice(at + 2) }
}

// One `dependencies:` entry ("numpy=1.26", "conda-forge::pandas>=2.0") to a Dep,
// or null to skip it (a nested pip map, python itself, or no pinned version).
function condaSpec(item: unknown): Dep | null {
  if (typeof item !== 'string') return null // nested pip: map — PyPI, out of scope
  const m = item.match(/^([^=<>!\s]+)\s*(==|=|>=|<=|>|<)?\s*([^=<>\s]+)?/)
  if (!m) return null
  const { name } = splitChannel(m[1])
  const current = m[3] ? baseVersion(m[3]) : null
  if (!current || name.toLowerCase() === 'python') return null
  return { name, current, resolved: m[2] === '=' || m[2] === '==' }
}

function parseEnvironmentYml(text: string): Dep[] {
  const list = parseYaml(text)?.dependencies
  if (!Array.isArray(list)) return []
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const dep = condaSpec(item)
    if (dep && !seen.has(dep.name)) {
      seen.add(dep.name)
      deps.push(dep)
    }
  }
  return deps
}

function parseCondaLock(text: string): Dep[] {
  const doc = parseYaml(text)
  const packages = doc?.package
  if (!Array.isArray(packages)) return []
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const pkg of packages) {
    const name = pkg?.name
    const version = pkg?.version
    if (typeof name !== 'string' || version == null || seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: String(version), resolved: true })
  }
  return deps
}

const stripEpoch = (v: string): { epoch: number; rest: string } => {
  const bang = v.indexOf('!')
  return bang === -1 ? { epoch: 0, rest: v } : { epoch: Number(v.slice(0, bang)) || 0, rest: v.slice(bang + 1) }
}

const condaOps: VersionOps = {
  compare(a, b) {
    const pa = stripEpoch(a)
    const pb = stripEpoch(b)
    if (pa.epoch !== pb.epoch) return pa.epoch < pb.epoch ? -1 : 1
    return sharedCompare(pa.rest, pb.rest)
  },
  isPrerelease: (v) => sharedPre(stripEpoch(v).rest),
}

export const conda: EcosystemDef = {
  id: 'conda',
  label: 'conda',
  purlTypes: ['conda'],
  manifests: ['environment.yml', 'environment.yaml'],
  locks: ['conda-lock.yml'],
  versionOps: condaOps,
  parse: (text, base) => (base === 'conda-lock.yml' ? parseCondaLock(text) : parseEnvironmentYml(text)),
  async fetchVersions(name) {
    const { channel, name: pkg } = splitChannel(name)
    const d = await getJson(`https://api.anaconda.org/package/${channel}/${encodeURIComponent(pkg)}`)
    const seen = new Set<string>()
    const out: { version: string; released: string | null }[] = []
    // Prefer the dated files list; fall back to the plain versions array.
    for (const f of d?.files ?? []) {
      const v = String(f.version)
      if (seen.has(v)) continue
      seen.add(v)
      out.push({ version: v, released: toIso(f.upload_time ?? f.attrs?.timestamp) })
    }
    if (out.length === 0) for (const v of d?.versions ?? []) out.push({ version: String(v), released: null })
    return out
  },
}
