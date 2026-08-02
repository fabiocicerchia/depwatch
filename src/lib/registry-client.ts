// Version lists from the five public registries.
//
// One responsibility: given an ecosystem and a package name, say which versions
// exist and when each shipped. Everything the two axes need — drift, pulse,
// cadence — is derivable from that, which is why the deep tier in signals.ts is
// the only thing that makes a second request.
//
// Failures are values, not exceptions: one unreachable package must degrade to
// "unknown" in the report, not abort the whole manifest.

import type { Ecosystem } from './semver.js'

export interface RegistryVersion {
  version: string
  released: string | null // ISO 8601; null when the registry does not date it
}

export interface PackageInfo {
  name: string
  ecosystem: Ecosystem
  versions: RegistryVersion[]
}

export interface RegistryError {
  error: string
}

const HEADERS = { Accept: 'application/json', 'User-Agent': 'depwatch' }

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(res.status === 404 ? 'not found in registry' : `registry HTTP ${res.status}`)
  return res.json()
}

export async function fetchPackage(eco: Ecosystem, name: string): Promise<PackageInfo | RegistryError> {
  try {
    const versions = await versionsOf(eco, name)
    if (versions.length === 0) return { error: 'registry returned no versions' }
    return { name, ecosystem: eco, versions }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function versionsOf(eco: Ecosystem, name: string): Promise<RegistryVersion[]> {
  switch (eco) {
    case 'npm':
      return npm(name)
    case 'pep440':
      return pypi(name)
    case 'cargo':
      return crates(name)
    case 'composer':
      return packagist(name)
    case 'rubygems':
      return rubygems(name)
  }
}

// The "time" map dates every publish; "created"/"modified" are package-level
// entries in the same object and are not versions.
async function npm(name: string): Promise<RegistryVersion[]> {
  const d = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  const time: Record<string, string> = d?.time ?? {}
  return Object.entries(time)
    .filter(([v]) => v !== 'created' && v !== 'modified')
    .map(([version, released]) => ({ version, released }))
}

// PyPI dates files, not releases; a release with no files was yanked or never
// uploaded, so take the first file's timestamp and drop the empty ones.
async function pypi(name: string): Promise<RegistryVersion[]> {
  const d = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
  const releases: Record<string, any[]> = d?.releases ?? {}
  const out: RegistryVersion[] = []
  for (const [version, files] of Object.entries(releases)) {
    const file = (files ?? []).find((f: any) => !f?.yanked)
    if (!file) continue
    out.push({ version, released: file.upload_time_iso_8601 ?? file.upload_time ?? null })
  }
  return out
}

async function crates(name: string): Promise<RegistryVersion[]> {
  const d = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)
  return (d?.versions ?? [])
    .filter((v: any) => !v?.yanked)
    .map((v: any) => ({ version: String(v.num), released: v.created_at ?? null }))
}

// p2 is the metadata-only endpoint: versions and dates, none of the rest.
// The vendor/package slash is part of the path, so it is not encoded.
async function packagist(name: string): Promise<RegistryVersion[]> {
  const d = await getJson(`https://repo.packagist.org/p2/${name}.json`)
  const list: any[] = d?.packages?.[name] ?? []
  return list.map((v) => ({ version: String(v.version).replace(/^v/, ''), released: v.time ?? null }))
}

async function rubygems(name: string): Promise<RegistryVersion[]> {
  const d = await getJson(`https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`)
  return (Array.isArray(d) ? d : []).map((v: any) => ({ version: String(v.number), released: v.created_at ?? null }))
}
