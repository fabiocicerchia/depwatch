// Elixir / Erlang — Hex. mix.lock pins exact versions in an Elixir map literal;
// mix.exs states ranges in a deps/0 list. hex.pm returns every release with its
// date in one request, and the package meta carries repo links.

import type { EcosystemDef } from './types.js'
import { getJson } from './http.js'
import { type Dep, baseVersion } from './parse-util.js'
import { toIso } from './meta.js'

// mix.lock: `"phoenix": {:hex, :phoenix, "1.7.11", "hash", [:mix], [...], ...}`.
function parseMixLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  const re = /"([a-zA-Z0-9_]+)":\s*\{:hex,\s*:[a-zA-Z0-9_]+,\s*"([^"]+)"/g
  for (const m of text.matchAll(re)) {
    const [, name, version] = m
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: true })
  }
  return deps
}

// mix.exs deps/0: `{:phoenix, "~> 1.7"}`, `{:ecto, ">= 3.0.0", only: :test}`.
// git/path deps have no version string and are skipped.
function parseMixExs(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  const re = /\{\s*:([a-zA-Z0-9_]+)\s*,\s*"([^"]+)"/g
  for (const m of text.matchAll(re)) {
    const [, name, range] = m
    const current = baseVersion(range)
    if (!current || seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current, resolved: false })
  }
  return deps
}

export const hex: EcosystemDef = {
  id: 'hex',
  label: 'Hex',
  purlTypes: ['hex'],
  manifests: ['mix.exs'],
  locks: ['mix.lock'],
  parse: (text, base) => (base === 'mix.lock' ? parseMixLock(text) : parseMixExs(text)),
  async fetchVersions(name) {
    const d = await getJson(`https://hex.pm/api/packages/${encodeURIComponent(name)}`)
    return (d?.releases ?? []).map((r: any) => ({ version: String(r.version), released: toIso(r.inserted_at) }))
  },
  async fetchRepoMeta(name) {
    const d = await getJson(`https://hex.pm/api/packages/${encodeURIComponent(name)}`)
    const links: Record<string, string> = d?.meta?.links ?? {}
    const repo = Object.entries(links).find(([k]) => /github|gitlab|source|repo/i.test(k))?.[1] ?? null
    return {
      repoUrl: repo,
      maintainerCount: Array.isArray(d?.owners) ? d.owners.length : null,
      hasFunding: Object.keys(links).some((k) => /fund|sponsor|donat|opencollective/i.test(k)),
    }
  },
}
