// Terraform / OpenTofu — the provider registry. .terraform.lock.hcl pins exact
// provider versions and is the good input; *.tf required_providers states
// ranges. The registry lists versions undated, so dates are hydrated from the
// per-version endpoint (verify the published_at field where the registry is
// reachable; falls back to undated cleanly).
//
// Providers only: the lock file pins providers, not modules. Non-default
// registry hostnames (private registries) are skipped rather than guessed at.

import type { EcosystemDef, RegistryVersion } from './types.js'
import { getJson } from './http.js'
import { type Dep, baseVersion } from './parse-util.js'

const DEFAULT_HOSTS = new Set(['registry.terraform.io', 'registry.opentofu.org'])

// A provider address is host/namespace/name; the default host is implied when
// only namespace/name is given. Returns "namespace/name", or null to skip.
function providerId(address: string): string | null {
  const parts = address.split('/')
  if (parts.length === 3) {
    if (!DEFAULT_HOSTS.has(parts[0])) return null // private registry — skip
    return `${parts[1]}/${parts[2]}`
  }
  if (parts.length === 2) return address
  return null
}

// .terraform.lock.hcl: provider "registry.terraform.io/hashicorp/aws" { version = "5.31.0" ... }
function parseLockHcl(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  const re = /provider\s+"([^"]+)"\s*\{([^}]*)\}/g
  for (const m of text.matchAll(re)) {
    const id = providerId(m[1])
    const version = m[2].match(/version\s*=\s*"([^"]+)"/)?.[1]
    if (!id || !version || seen.has(id)) continue
    seen.add(id)
    deps.push({ name: id, current: version, resolved: true })
  }
  return deps
}

// *.tf required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
function parseTf(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  const re = /[\w-]+\s*=\s*\{([^}]*?source\s*=\s*"[^"]+"[^}]*)\}/g
  for (const m of text.matchAll(re)) {
    const block = m[1]
    const source = block.match(/source\s*=\s*"([^"]+)"/)?.[1]
    const version = block.match(/version\s*=\s*"([^"]+)"/)?.[1]
    if (!source || !version) continue
    const id = providerId(source)
    const current = baseVersion(version)
    if (!id || !current || seen.has(id)) continue
    seen.add(id)
    deps.push({ name: id, current, resolved: false })
  }
  return deps
}

export const terraform: EcosystemDef = {
  id: 'terraform',
  label: 'Terraform',
  purlTypes: ['terraform'],
  manifests: ['.terraform.lock.hcl'],
  manifestPattern: /\.tf$/,
  // The lock file IS a manifest name here; there is no separate lock/manifest
  // pair, so `locks` stays empty and .terraform.lock.hcl is detected as an exact
  // manifest that already carries resolved versions.
  locks: [],
  parse: (text, base) => (base === '.terraform.lock.hcl' ? parseLockHcl(text) : parseTf(text)),
  async fetchVersions(name) {
    const d = await getJson(`https://registry.terraform.io/v1/providers/${name}/versions`)
    return (d?.versions ?? []).map((v: any): RegistryVersion => ({ version: String(v.version), released: null }))
  },
  async hydrateDates(name, versions) {
    const out = new Map<string, string>()
    await Promise.all(
      versions.map(async (v) => {
        try {
          const d = await getJson(`https://registry.terraform.io/v1/providers/${name}/${v}`)
          const published = d?.published_at ?? d?.published
          if (published) out.set(v, new Date(published).toISOString())
        } catch {
          // undatable version stays unknown; drift degrades, it does not lie
        }
      }),
    )
    return out
  },
}
