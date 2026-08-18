// Swift / Objective-C — CocoaPods. Podfile.lock pins exact versions; the trunk
// API dates every version. Built against the documented trunk API shape
// (versions[].name / created_at); verify with `depwatch check Podfile.lock`
// where the CocoaPods trunk host is reachable.

import type { EcosystemDef } from './types.js'
import { getJson } from './http.js'
import { parseYaml } from './yaml.js'
import type { Dep } from './parse-util.js'
import { toIso } from './meta.js'

// Podfile.lock PODS entries: "- Alamofire (5.8.1)" and subspec dependency lines
// "- Alamofire/Core (5.8.1)". The pod is the name before the first slash.
function parsePodfileLock(text: string): Dep[] {
  const doc = parseYaml(text)
  const pods = doc?.PODS
  if (!Array.isArray(pods)) return []
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const item of pods) {
    // A pod with dependencies parses as a single-key mapping; a leaf as a string.
    const label = typeof item === 'string' ? item : Object.keys(item ?? {})[0]
    const m = String(label ?? '').match(/^([^/\s(]+)(?:\/[^\s(]+)?\s*\(([^)]+)\)/)
    if (!m) continue
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: m[2], resolved: true })
  }
  return deps
}

export const cocoapods: EcosystemDef = {
  id: 'cocoapods',
  label: 'CocoaPods',
  purlTypes: ['cocoapods'],
  manifests: [],
  locks: ['Podfile.lock'],
  parse: (text) => parsePodfileLock(text),
  async fetchVersions(name) {
    const d = await getJson(`https://trunk.cocoapods.org/api/v1/pods/${encodeURIComponent(name)}`)
    return (d?.versions ?? []).map((v: any) => ({ version: String(v.name), released: toIso(v.created_at) }))
  },
}
