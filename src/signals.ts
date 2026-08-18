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
import type { EcoId, RepoMeta } from './ecosystems/types.js'
import { byId } from './ecosystems/registry.js'
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

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'depwatch', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Registry-side --deep metadata: repo URL, maintainer count (bus factor),
// funding, and any terminal end-of-life flag the registry states directly. Each
// ecosystem owns its own extraction via EcosystemDef.fetchRepoMeta; an ecosystem
// without one simply has no deep registry signals — there is no switch arm left
// to forget.
async function fetchRepoMeta(eco: EcoId, name: string): Promise<RepoMeta> {
  const empty: RepoMeta = { repoUrl: null, maintainerCount: null, hasFunding: false }
  const def = byId(eco)
  if (!def?.fetchRepoMeta) return empty
  try {
    return await def.fetchRepoMeta(name)
  } catch {
    return empty // enrichment is best-effort; the cheap tier still scored the package
  }
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

export async function deepSignals(eco: EcoId, name: string, base: ViabilitySignals, now = Date.now()): Promise<ViabilitySignals> {
  const meta = await fetchRepoMeta(eco, name)
  const merged: ViabilitySignals = {
    ...base,
    maintainerCount: meta.maintainerCount ?? base.maintainerCount,
    hasFunding: base.hasFunding || meta.hasFunding,
    // A registry that states end-of-life directly (Helm `deprecated`) is as
    // terminal as GitHub `archived`.
    archived: base.archived || Boolean(meta.archived),
  }
  const slug = githubSlug(meta.repoUrl)
  if (!slug) return merged
  const gh = await fetchGitHub(slug, now)
  if (!gh) return merged
  return { ...merged, archived: gh.archived, lastCommitAgeDays: gh.lastCommitAgeDays }
}
