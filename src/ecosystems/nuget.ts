// .NET — NuGet. packages.lock.json pins exact versions; *.csproj and the legacy
// packages.config state the requested version. The v3 registration index returns
// every version with its publish date, usually inlined; very large packages page
// it, which is the one case that costs an extra request per page.

import type { EcosystemDef, RegistryVersion } from './types.js'
import { getJson } from './http.js'
import { type Dep, baseVersion } from './parse-util.js'
import { repoUrlOf, toIso } from './meta.js'

function parsePackagesLockJson(text: string): Dep[] {
  let doc: any
  try {
    doc = JSON.parse(text)
  } catch {
    return []
  }
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const framework of Object.values<any>(doc?.dependencies ?? {})) {
    for (const [name, entry] of Object.entries<any>(framework ?? {})) {
      const version = entry?.resolved
      if (typeof version !== 'string' || seen.has(name)) continue
      seen.add(name)
      deps.push({ name, current: version, resolved: true })
    }
  }
  return deps
}

function parseCsproj(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  // <PackageReference Include="X" Version="1.2.3" /> or a nested <Version> child.
  const re = /<PackageReference\s+Include="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/g
  for (const m of text.matchAll(re)) {
    const name = m[1]
    const attrVersion = m[2].match(/Version="([^"]+)"/)?.[1]
    const childVersion = m[3]?.match(/<Version>([^<]+)<\/Version>/)?.[1]
    const current = baseVersion(String(attrVersion ?? childVersion ?? ''))
    if (!current || seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current, resolved: false })
  }
  return deps
}

function parsePackagesConfig(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/<package\s+id="([^"]+)"\s+version="([^"]+)"/g)) {
    const [, name, version] = m
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: true })
  }
  return deps
}

// NuGet marks an unlisted package with the sentinel year 1900; treat as undated.
const realDate = (published: unknown): string | null => {
  const iso = toIso(published)
  return iso?.startsWith('1900') ? null : iso
}

async function pageEntries(page: any): Promise<any[]> {
  if (Array.isArray(page?.items)) return page.items
  if (page?.['@id']) return (await getJson(page['@id']))?.items ?? []
  return []
}

export const nuget: EcosystemDef = {
  id: 'nuget',
  label: 'NuGet',
  purlTypes: ['nuget'],
  manifests: ['packages.config'],
  manifestPattern: /\.csproj$/,
  locks: ['packages.lock.json'],
  parse(text, base) {
    if (base === 'packages.lock.json') return parsePackagesLockJson(text)
    if (base === 'packages.config') return parsePackagesConfig(text)
    return parseCsproj(text)
  },
  async fetchVersions(name) {
    const id = name.toLowerCase()
    const idx = await getJson(`https://api.nuget.org/v3/registration5-gz-semver2/${id}/index.json`)
    const out: RegistryVersion[] = []
    for (const page of idx?.items ?? []) {
      for (const it of await pageEntries(page)) {
        const e = it?.catalogEntry
        if (!e || e.listed === false) continue
        out.push({ version: String(e.version), released: realDate(e.published) })
      }
    }
    return out
  },
  async fetchRepoMeta(name) {
    const id = name.toLowerCase()
    const idx = await getJson(`https://api.nuget.org/v3/registration5-gz-semver2/${id}/index.json`)
    const lastPage = idx?.items?.[idx.items.length - 1]
    const entries = lastPage ? await pageEntries(lastPage) : []
    const e = entries[entries.length - 1]?.catalogEntry
    return {
      repoUrl: repoUrlOf(e?.repository?.url ?? e?.projectUrl),
      maintainerCount: null, // NuGet exposes owners via a separate search API
      hasFunding: false,
    }
  },
}
