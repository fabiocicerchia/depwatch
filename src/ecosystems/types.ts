// The ecosystem seam.
//
// Before this, an ecosystem was defined by adding a `case` or a `Record` entry
// in six separate files (manifest.ts, sbom.ts, signals.ts, report.ts,
// registry-client.ts, cli.ts), and one of those sites had a `default:` arm that
// swallowed a missing ecosystem silently. An `EcosystemDef` gathers everything
// one ecosystem needs into a single object, and `REGISTRY` (see ./registry.ts)
// is the one place that lists them — so adding a language is one file plus one
// test, and a half-finished one is a type error rather than a silent gap.

import type { RegistryVersion } from '@lib/registry-client'
import type { Dep } from '@lib/libyear/engine'

export type { RegistryVersion }

// The five the shared @lib engine already reaches, plus everything layered on
// top of it here. The shared `fetchPackage` only knows the first five; the rest
// implement `fetchVersions` themselves. Keep this in sync with REGISTRY — the
// `Record<EcoId, EcosystemDef>` typing makes an omission a compile error.
export type EcoId =
  | 'npm'
  | 'pep440'
  | 'cargo'
  | 'composer'
  | 'rubygems'
  | 'pub'
  | 'hex'
  | 'nuget'
  | 'cocoapods'
  | 'conda'
  | 'helm'
  | 'go'
  | 'maven'
  | 'terraform'
  | 'githubactions'
  | 'docker'
// Grows one line per ecosystem added. Because REGISTRY is Record<EcoId,
// EcosystemDef>, adding a member here without a def — or a def without a member —
// is a compile error, which is the whole point of the seam.

// Repo-host + registry metadata for the --deep tier. Same shape signals.ts used
// internally; moved here so each ecosystem owns its own extraction.
export interface RepoMeta {
  repoUrl: string | null
  maintainerCount: number | null
  hasFunding: boolean
  // Some registries mark end-of-life directly (Helm `deprecated`, npm `unpublished`).
  // Terminal, like GitHub `archived`.
  archived?: boolean
}

// Version ordering is the one thing not every ecosystem shares. npm, PEP 440,
// Cargo, Composer, RubyGems, Go release tags, pub, Hex, NuGet and Terraform all
// lead with dot-separated integers and use the shared @lib/semver comparator.
// Maven (`33.0.0-jre`, `r03`) and conda (epoch `1!1.2.3`) do not, and supply
// their own.
export interface VersionOps {
  compare(a: string, b: string): number
  isPrerelease(v: string): boolean
}

export interface EcosystemDef {
  id: EcoId
  // Human label — CLI help and docs read from this so they cannot drift.
  label: string
  // PURL types that map to this ecosystem (replaces sbom.ts PURL_ECOSYSTEM).
  purlTypes: string[]
  // Exact manifest basenames (ranges — resolved:false).
  manifests: string[]
  // Manifests matched by shape rather than exact name (requirements*.txt).
  manifestPattern?: RegExp
  // Matched against the whole path, not the basename — for files whose name is
  // too generic to detect (a workflow ci.yml is only meaningful under
  // .github/workflows/). Checked before manifestPattern.
  pathPattern?: RegExp
  // Lock basenames in preference order (resolved versions — resolved:true).
  locks: string[]

  parse(text: string, basename: string): Dep[]
  fetchVersions(name: string): Promise<RegistryVersion[]>

  // Registries that list versions without dates return released:null from
  // fetchVersions and date only the versions actually scored here.
  hydrateDates?(name: string, versions: string[]): Promise<Map<string, string>>

  // --deep tier. Absent → no deep signals for this ecosystem (no silent switch arm).
  fetchRepoMeta?(name: string): Promise<RepoMeta>

  // Override the shared dot-integer comparator. Absent → @lib/semver.
  versionOps?: VersionOps

  // Docker: honest dates, no orderable version series — pulse and viability only,
  // drift reported as "—" rather than 0. Default true.
  driftScorable?: boolean
}
