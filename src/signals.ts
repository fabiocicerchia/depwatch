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
  lastCommitAgeDays: number | null
}

export async function fetchGitHub(slug: string, now = Date.now()): Promise<GitHubMeta | null> {
  const token = process.env.GITHUB_TOKEN
  try {
    const d = await getJson(`https://api.github.com/repos/${slug}`, token ? { Authorization: `Bearer ${token}` } : {})
    return {
      archived: Boolean(d.archived),
      lastCommitAgeDays: d.pushed_at ? Math.max(0, (now - Date.parse(d.pushed_at)) / MS_PER_DAY) : null,
    }
  } catch {
    return null // rate limited or private; the cheap tier still scored the package
  }
}

export async function deepSignals(eco: Ecosystem, name: string, base: ViabilitySignals, now = Date.now()): Promise<ViabilitySignals> {
  const meta = await fetchRepoMeta(eco, name)
  const merged: ViabilitySignals = {
    ...base,
    maintainerCount: meta.maintainerCount ?? base.maintainerCount,
    hasFunding: base.hasFunding || meta.hasFunding,
  }
  const slug = githubSlug(meta.repoUrl)
  if (!slug) return merged
  const gh = await fetchGitHub(slug, now)
  if (!gh) return merged
  return { ...merged, archived: gh.archived, lastCommitAgeDays: gh.lastCommitAgeDays }
}
