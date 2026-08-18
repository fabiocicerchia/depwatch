// GitHub Actions — `uses:` refs in workflow files. Versions and dates come from
// the repo's GitHub releases (dated in one request); tags are the fallback,
// hydrated per-tag from the commit date. Shares the unauthenticated 60 req/hr
// GitHub budget with the --deep tier, so it honours GITHUB_TOKEN and degrades to
// "no data" rather than failing the run.

import type { EcosystemDef, RegistryVersion } from './types.js'
import type { Dep } from './parse-util.js'

const API = 'https://api.github.com'
const ghHeaders = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'depwatch',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}
async function ghJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: ghHeaders() })
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
  return res.json()
}

// A full semver tag is a resolved pin; a moving major (v4) or a SHA is not.
const isExactTag = (ref: string) => /^v?\d+\.\d+\.\d+$/.test(ref)
const isSha = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref)

// uses: owner/repo@ref | owner/repo/path@ref (reusable workflow). Skips ./local
// and docker:// forms.
function parseUses(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)/gm)) {
    const ref = m[1]
    if (ref.startsWith('./') || ref.startsWith('.\\') || ref.startsWith('docker://')) continue
    const at = ref.lastIndexOf('@')
    if (at <= 0) continue
    const path = ref.slice(0, at)
    const version = ref.slice(at + 1)
    // owner/repo, keeping any /path off the identity.
    const parts = path.split('/')
    if (parts.length < 2) continue
    const name = `${parts[0]}/${parts[1]}`
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: isExactTag(version) && !isSha(version) })
  }
  return deps
}

export const githubActions: EcosystemDef = {
  id: 'githubactions',
  label: 'GitHub Actions',
  purlTypes: ['github', 'githubactions'],
  manifests: ['action.yml', 'action.yaml'],
  // Workflow filenames are generic; only their directory identifies them.
  pathPattern: /\.github\/workflows\/[^/]+\.ya?ml$/,
  locks: [],
  parse: (text) => parseUses(text),
  async fetchVersions(name) {
    // Releases carry publish dates in one request.
    const releases = await ghJson(`/repos/${name}/releases?per_page=100`)
    if (Array.isArray(releases) && releases.length > 0) {
      return releases
        .filter((r: any) => !r.draft)
        .map((r: any): RegistryVersion => ({ version: String(r.tag_name), released: r.published_at ?? null }))
    }
    // Fall back to tags (undated — hydrated below).
    const tags = await ghJson(`/repos/${name}/tags?per_page=100`)
    return (Array.isArray(tags) ? tags : []).map((t: any): RegistryVersion => ({ version: String(t.name), released: null }))
  },
  async hydrateDates(name, versions) {
    const out = new Map<string, string>()
    await Promise.all(
      versions.map(async (v) => {
        try {
          const ref = await ghJson(`/repos/${name}/git/refs/tags/${v}`)
          const sha = ref?.object?.sha
          if (!sha) return
          const commit = await ghJson(`/repos/${name}/commits/${sha}`)
          const date = commit?.commit?.committer?.date ?? commit?.commit?.author?.date
          if (date) out.set(v, new Date(date).toISOString())
        } catch {
          // rate limited or missing tag; the version stays undated
        }
      }),
    )
    return out
  },
  async fetchRepoMeta(name) {
    // The deep tier's GitHub layer already reads archived/last-commit from the
    // slug; here we only need to point it at the repo.
    return { repoUrl: `https://github.com/${name}`, maintainerCount: null, hasFunding: false }
  },
}
