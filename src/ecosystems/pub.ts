// Dart / Flutter — pub.dev. pubspec.lock pins exact versions; pubspec.yaml
// states ranges. The registry returns every version with its publish date in
// one request.

import type { EcosystemDef } from './types.js'
import { getJson } from './http.js'
import { parseYaml } from './yaml.js'
import { type Dep, baseVersion } from './parse-util.js'
import { repoUrlOf, toIso } from './meta.js'

function parsePubspecLock(text: string): Dep[] {
  const doc = parseYaml(text)
  const packages = doc?.packages
  if (!packages || typeof packages !== 'object') return []
  const deps: Dep[] = []
  for (const [name, entry] of Object.entries<any>(packages)) {
    const version = entry?.version
    if (typeof version === 'string') deps.push({ name, current: String(version), resolved: true })
  }
  return deps
}

function parsePubspecYaml(text: string): Dep[] {
  const doc = parseYaml(text)
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const section of ['dependencies', 'dev_dependencies']) {
    const table = doc?.[section]
    if (!table || typeof table !== 'object') continue
    for (const [name, spec] of Object.entries<any>(table)) {
      // `flutter: { sdk: flutter }`, path and git deps are objects — not on pub.
      if (spec === null || typeof spec === 'object') continue
      const current = baseVersion(String(spec))
      if (current && !seen.has(name)) {
        seen.add(name)
        deps.push({ name, current, resolved: false })
      }
    }
  }
  return deps
}

export const pub: EcosystemDef = {
  id: 'pub',
  label: 'pub.dev',
  purlTypes: ['pub'],
  manifests: ['pubspec.yaml'],
  locks: ['pubspec.lock'],
  parse: (text, base) => (base === 'pubspec.lock' ? parsePubspecLock(text) : parsePubspecYaml(text)),
  async fetchVersions(name) {
    const d = await getJson(`https://pub.dev/api/packages/${encodeURIComponent(name)}`)
    return (d?.versions ?? []).map((v: any) => ({ version: String(v.version), released: toIso(v.published) }))
  },
  async fetchRepoMeta(name) {
    const d = await getJson(`https://pub.dev/api/packages/${encodeURIComponent(name)}`)
    const ps = d?.latest?.pubspec ?? {}
    return {
      repoUrl: repoUrlOf(ps.repository ?? ps.homepage),
      maintainerCount: null, // pub.dev exposes publisher, not a maintainer list
      hasFunding: Array.isArray(ps.funding) && ps.funding.length > 0,
    }
  },
}
