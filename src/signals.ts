// Where the viability signals come from.
//
// Cheap tier (always): everything derivable from the version timeline the shared
// registry-client already fetched — pulse and release cadence. No extra request,
// works for all five ecosystems.
//
// Deep tier (--deep): one registry metadata request per package for maintainer
// count / repo URL / funding, plus one GitHub request for archived + last commit.
// Opt-in because it multiplies request count and GitHub rate-limits hard without
// a token (set GITHUB_TOKEN).

import type { RegistryVersion } from '@lib/registry-client'
import type { Ecosystem } from '@lib/semver'
import { NO_SIGNALS, type ViabilitySignals } from './viability.js'

const MS_PER_DAY = 86_400_000

function releaseDates(versions: RegistryVersion[]): number[] {
  return versions
    .map((v) => (v.released ? Date.parse(v.released) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
}

function median(ns: number[]): number | null {
  if (ns.length === 0) return null
  const s = [...ns].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Cadence over the recent past only: a package that shipped monthly for a decade
// and then stopped two years ago should not be rewarded for its history. The
// pulse signal catches the stop, and this keeps cadence from arguing with it.
const CADENCE_WINDOW = 10

export function timelineSignals(versions: RegistryVersion[], now = Date.now()): ViabilitySignals {
  const dates = releaseDates(versions)
  if (dates.length === 0) return { ...NO_SIGNALS }

  const last = dates[dates.length - 1]
  const recent = dates.slice(-CADENCE_WINDOW - 1)
  const gaps: number[] = []
  for (let i = 1; i < recent.length; i++) gaps.push((recent[i] - recent[i - 1]) / MS_PER_DAY)

  return {
    ...NO_SIGNALS,
    lastReleaseAgeDays: Math.max(0, (now - last) / MS_PER_DAY),
    releaseCadenceDays: median(gaps),
  }
}

// --- deep tier ---

export interface RepoMeta {
  repoUrl: string | null
  maintainerCount: number | null
  hasFunding: boolean
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'depwatch', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Deliberately duplicated URLs rather than a second responsibility bolted onto
// the shared registry-client: that module is a browser dependency of
// infra-toolbox and stays a version-list fetcher.
export async function fetchRepoMeta(eco: Ecosystem, name: string): Promise<RepoMeta> {
  const empty: RepoMeta = { repoUrl: null, maintainerCount: null, hasFunding: false }
  try {
    switch (eco) {
      case 'npm': {
        const d = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
        const latest = d['dist-tags']?.latest
        const manifest = latest ? d.versions?.[latest] : undefined
        return {
          repoUrl: repoUrlOf(d.repository ?? manifest?.repository),
          maintainerCount: Array.isArray(d.maintainers) ? d.maintainers.length : null,
          hasFunding: Boolean(manifest?.funding ?? d.funding),
        }
      }
      case 'pep440': {
        const d = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
        const urls: Record<string, string> = d.info?.project_urls ?? {}
        const repo = Object.entries(urls).find(([k]) => /source|repo|code|github/i.test(k))?.[1] ?? d.info?.home_page
        return {
          repoUrl: repoUrlOf(repo),
          maintainerCount: null, // PyPI exposes a free-text author, not a maintainer list
          hasFunding: Object.keys(urls).some((k) => /fund|sponsor|donat/i.test(k)),
        }
      }
      case 'cargo': {
        const d = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)
        return { ...empty, repoUrl: repoUrlOf(d.crate?.repository) }
      }
      case 'composer': {
        const d = await getJson(`https://repo.packagist.org/packages/${name}.json`)
        const p = d.package
        return {
          repoUrl: repoUrlOf(p?.repository),
          maintainerCount: Array.isArray(p?.maintainers) ? p.maintainers.length : null,
          hasFunding: Array.isArray(p?.funding) && p.funding.length > 0,
        }
      }
      case 'rubygems': {
        const d = await getJson(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`)
        return {
          repoUrl: repoUrlOf(d.source_code_uri ?? d.homepage_uri),
          maintainerCount: null, // needs a second /owners call; not worth the request
          hasFunding: false,
        }
      }
      default:
        return empty
    }
  } catch {
    return empty // enrichment is best-effort; the cheap tier still scored the package
  }
}

function repoUrlOf(repo: unknown): string | null {
  const raw = typeof repo === 'string' ? repo : (repo as { url?: string } | null)?.url
  return raw ? String(raw) : null
}

export function githubSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

export interface GitHubMeta {
  archived: boolean
  // The commit timestamp, not an age in days: "how old is this" depends on when
  // you ask, and a cached answer to that question is wrong the moment it is
  // stored. Trend mode asks it once per sampled commit.
  pushedAt: string | null
}

export async function fetchGitHub(slug: string): Promise<GitHubMeta | null> {
  const token = process.env.GITHUB_TOKEN
  try {
    const d = await getJson(`https://api.github.com/repos/${slug}`, token ? { Authorization: `Bearer ${token}` } : {})
    return { archived: Boolean(d.archived), pushedAt: d.pushed_at ?? null }
  } catch {
    return null // rate limited or private; the cheap tier still scored the package
  }
}

// Everything the deep tier fetches, and nothing it derives — no value in here
// depends on the current time, which is what makes it safe to cache for hours
// and to reuse across the many `asOf` instants trend mode scores.
export interface DeepMeta {
  maintainerCount: number | null
  hasFunding: boolean
  archived: boolean
  lastCommitAt: string | null
}

export async function fetchDeepMeta(eco: Ecosystem, name: string): Promise<DeepMeta> {
  const meta = await fetchRepoMeta(eco, name)
  const out: DeepMeta = {
    maintainerCount: meta.maintainerCount,
    hasFunding: meta.hasFunding,
    archived: false,
    lastCommitAt: null,
  }
  const slug = githubSlug(meta.repoUrl)
  if (!slug) return out
  const gh = await fetchGitHub(slug)
  if (!gh) return out
  return { ...out, archived: gh.archived, lastCommitAt: gh.pushedAt }
}

export function applyDeepMeta(base: ViabilitySignals, meta: DeepMeta, now = Date.now()): ViabilitySignals {
  const commitAt = meta.lastCommitAt ? Date.parse(meta.lastCommitAt) : NaN
  return {
    ...base,
    maintainerCount: meta.maintainerCount ?? base.maintainerCount,
    hasFunding: base.hasFunding || meta.hasFunding,
    archived: base.archived || meta.archived,
    lastCommitAgeDays: Number.isFinite(commitAt) ? Math.max(0, (now - commitAt) / MS_PER_DAY) : base.lastCommitAgeDays,
  }
}

export async function deepSignals(eco: Ecosystem, name: string, base: ViabilitySignals, now = Date.now()): Promise<ViabilitySignals> {
  return applyDeepMeta(base, await fetchDeepMeta(eco, name), now)
}
