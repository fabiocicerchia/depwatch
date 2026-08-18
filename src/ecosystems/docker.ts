// Docker base images. A tag has an honest publish date but no orderable version
// series — `library/node` alone has thousands of tags, most of them moving
// aliases (latest, slim, bookworm) pushed the same day. So Docker is scored on
// pulse and viability only, with drift reported as "—" rather than a misleading
// 0 (driftScorable: false; see report.ts).
//
// Only Docker Hub images are dated here; other registries (ghcr.io, quay.io,
// ECR) use the OCI distribution API and often need auth, so they are skipped.

import type { EcosystemDef, RegistryVersion } from './types.js'
import { getJson } from './http.js'
import type { Dep } from './parse-util.js'

// FROM [--platform=x] image[:tag][@digest] [AS stage]
function parseDockerfile(text: string): Dep[] {
  const deps: Dep[] = []
  const stages = new Set<string>()
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i)
    if (!m) continue
    const ref = m[1]
    if (m[2]) stages.add(m[2].toLowerCase())
    if (ref.toLowerCase() === 'scratch' || stages.has(ref.toLowerCase())) continue // stage alias / scratch

    const image = dockerHubImage(ref)
    if (!image) continue // non-Docker-Hub registry or digest-only — not datable here
    if (seen.has(image.name)) continue
    seen.add(image.name)
    deps.push({ name: image.name, current: image.tag, resolved: true })
  }
  return deps
}

// Normalise a Docker Hub reference to { name: "namespace/repo", tag }. Returns
// null for other registries (a host with a dot or port before the first slash)
// and for digest-only pins, which the tags API cannot date.
function dockerHubImage(ref: string): { name: string; tag: string } | null {
  const atDigest = ref.includes('@')
  const body = ref.split('@')[0]
  const firstSlash = body.indexOf('/')
  const maybeHost = firstSlash === -1 ? '' : body.slice(0, firstSlash)
  if (/[.:]/.test(maybeHost) || maybeHost === 'localhost') return null // another registry

  const [path, tag] = splitTag(body)
  if (atDigest && !tag) return null // digest-only, no tag to date
  const name = path.includes('/') ? path : `library/${path}`
  return { name, tag: tag || 'latest' }
}

function splitTag(path: string): [string, string] {
  const lastSlash = path.lastIndexOf('/')
  const colon = path.indexOf(':', lastSlash + 1)
  return colon === -1 ? [path, ''] : [path.slice(0, colon), path.slice(colon + 1)]
}

export const docker: EcosystemDef = {
  id: 'docker',
  label: 'Docker',
  purlTypes: ['docker', 'oci'],
  manifests: ['Dockerfile', 'Containerfile'],
  manifestPattern: /^(Dockerfile|Containerfile)(\..*)?$/i,
  locks: [],
  driftScorable: false,
  parse: (text) => parseDockerfile(text),
  async fetchVersions(name) {
    // Recent tags with their push dates — feeds the viability/cadence signals.
    // The current tag is dated exactly in hydrateDates, since it may be older
    // than this window.
    const d = await getJson(`https://hub.docker.com/v2/repositories/${name}/tags?page_size=100`)
    return (d?.results ?? []).map(
      (t: any): RegistryVersion => ({ version: String(t.name), released: t.tag_last_pushed ?? null }),
    )
  },
  async hydrateDates(name, versions) {
    const out = new Map<string, string>()
    await Promise.all(
      versions.map(async (tag) => {
        try {
          const d = await getJson(`https://hub.docker.com/v2/repositories/${name}/tags/${encodeURIComponent(tag)}`)
          if (d?.tag_last_pushed) out.set(tag, new Date(d.tag_last_pushed).toISOString())
        } catch {
          // an unknown or removed tag stays undated → pulse shows —
        }
      }),
    )
    return out
  },
}
