// Helm charts. Unlike every other ecosystem here, a chart's identity is
// (repository URL, chart name) rather than a bare name — charts live in
// arbitrary repositories, not one registry host. So this def is `scoped`: the
// Dep.name carries "<repo>#<chart>", and the version fetcher caches the parsed
// index.yaml per repository, since one index (which can be tens of megabytes)
// covers every chart in it.
//
// Built against the well-known Helm repository index.yaml shape
// (entries.<chart>[].{version,created,deprecated,sources}); verify with
// `depwatch check Chart.lock` where the chart repo is reachable. oci:// chart
// refs use a dateless protocol and are skipped.

import type { EcosystemDef, RegistryVersion, RepoMeta } from './types.js'
import { getText } from './http.js'
import { parseYaml } from './yaml.js'
import { type Dep, baseVersion } from './parse-util.js'
import { toIso } from './meta.js'

const SEP = '#'
const qualify = (repo: string, chart: string) => `${repo.replace(/\/+$/, '')}${SEP}${chart}`
const split = (name: string): { repo: string; chart: string } => {
  const at = name.lastIndexOf(SEP)
  return { repo: name.slice(0, at), chart: name.slice(at + 1) }
}

interface IndexEntry {
  version: string
  created?: string
  deprecated?: boolean
  sources?: string[]
}

// One parsed index.yaml per repository URL, shared across every chart from it.
const indexCache = new Map<string, Promise<Record<string, IndexEntry[]>>>()

function fetchIndex(repo: string): Promise<Record<string, IndexEntry[]>> {
  const key = repo.replace(/\/+$/, '')
  let hit = indexCache.get(key)
  if (!hit) {
    hit = getText(`${key}/index.yaml`).then((text) => (parseYaml(text)?.entries ?? {}) as Record<string, IndexEntry[]>)
    indexCache.set(key, hit)
  }
  return hit
}

function parseDeps(text: string, resolved: boolean): Dep[] {
  const doc = parseYaml(text)
  const list = doc?.dependencies
  if (!Array.isArray(list)) return []
  const deps: Dep[] = []
  for (const dep of list) {
    const chart = dep?.name
    const repo = dep?.repository
    const version = dep?.version
    if (typeof chart !== 'string' || typeof repo !== 'string' || version == null) continue
    if (repo.startsWith('oci://')) continue // dateless protocol — cannot be scored
    const current = resolved ? String(version) : baseVersion(String(version))
    if (!current) continue
    deps.push({ name: qualify(repo, chart), current, resolved })
  }
  return deps
}

export const helm: EcosystemDef = {
  id: 'helm',
  label: 'Helm',
  purlTypes: ['helm'],
  manifests: ['Chart.yaml'],
  locks: ['Chart.lock'],
  scoped: true,
  parse: (text, base) => parseDeps(text, base === 'Chart.lock'),
  async fetchVersions(name) {
    const { repo, chart } = split(name)
    const entries = await fetchIndex(repo)
    const versions: IndexEntry[] = entries[chart] ?? []
    return versions.map(
      (v): RegistryVersion => ({ version: String(v.version), released: toIso(v.created) }),
    )
  },
  async fetchRepoMeta(name): Promise<RepoMeta> {
    const { repo, chart } = split(name)
    const entries = await fetchIndex(repo)
    const versions = entries[chart] ?? []
    const latest = versions[0] // Helm indexes list newest first
    return {
      repoUrl: Array.isArray(latest?.sources) ? (latest.sources[0] ?? null) : null,
      maintainerCount: null,
      hasFunding: false,
      // A deprecated chart is end-of-life, as terminal as an archived repo.
      archived: versions.some((v) => v.deprecated === true),
    }
  },
}
