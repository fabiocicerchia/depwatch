import { fetchPackage } from '@lib/registry-client'
import type { EcosystemDef } from './types.js'
import { type Dep, baseVersion } from './parse-util.js'
import { getJson } from './http.js'
import { repoUrlOf } from './meta.js'

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

async function shared(name: string) {
  const info = await fetchPackage('rubygems', name)
  if ('error' in info) throw new Error(info.error)
  return info.versions
}

export const rubygems: EcosystemDef = {
  id: 'rubygems',
  label: 'RubyGems',
  purlTypes: ['gem'],
  manifests: [],
  locks: ['Gemfile.lock'],
  parse: (text) => parseGemfileLock(text),
  fetchVersions: shared,
  async fetchRepoMeta(name) {
    const d = await getJson(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`)
    return {
      repoUrl: repoUrlOf(d.source_code_uri ?? d.homepage_uri),
      maintainerCount: null, // needs a second /owners call; not worth the request
      hasFunding: false,
    }
  },
}
