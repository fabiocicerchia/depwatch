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

/**
 * The signals derivable from a version timeline alone — the cheap tier.
 *
 * Pulse and release cadence come free from the version list the registry client
 * already fetched: no extra request, and they work for every ecosystem.
 *
 * @param versions Every known version, with release dates.
 * @param now      Instant to measure age against; overridden in trend mode.
 * @returns Signals with the timeline fields filled and the rest left unknown.
 */
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

/**
 * Extracts `owner/repo` from a repository URL.
 *
 * @param repoUrl Any of the shapes registries record — git+ssh, https, with or
 *                without a `.git` suffix.
 * @returns The slug, or null when the URL is missing or not a GitHub one.
 */
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

/**
 * Fetches the two signals only a repo host can answer: archived, and last
 * commit.
 *
 * @param slug `owner/repo`.
 * @returns The metadata, or null on any failure — GitHub rate-limits hard
 *          without a `GITHUB_TOKEN`, and a missed signal must degrade the score
 *          rather than fail the report.
 */
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

/**
 * Fetches the per-package metadata behind the deep tier: maintainer count, repo
 * URL and funding.
 *
 * One extra registry request per package, which is why `--deep` is opt-in.
 *
 * @param eco  Which registry to ask.
 * @param name Package name.
 * @returns Whatever could be read; every field is optional.
 */
export async function fetchDeepMeta(eco: EcoId, name: string): Promise<DeepMeta> {
  const meta = await fetchRepoMeta(eco, name)
  const out: DeepMeta = {
    maintainerCount: meta.maintainerCount,
    hasFunding: meta.hasFunding,
    // A registry that states end-of-life directly (Helm `deprecated`) is as
    // terminal as GitHub `archived`.
    archived: Boolean(meta.archived),
    lastCommitAt: null,
  }
  const slug = githubSlug(meta.repoUrl)
  if (!slug) return out
  const gh = await fetchGitHub(slug)
  if (!gh) return out
  return { ...out, archived: gh.archived, lastCommitAt: gh.pushedAt }
}

/**
 * Folds deep-tier metadata into the timeline signals.
 *
 * @param base The cheap-tier signals.
 * @param meta What the deep tier found.
 * @param now  Instant to measure commit age against.
 * @returns A new signal set; fields the deep tier could not answer stay
 *          unknown, and the score renormalises around what is present.
 */
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

/**
 * The deep tier end to end: fetch the metadata, then fold it in.
 *
 * @param eco  Which registry to ask.
 * @param name Package name.
 * @param base The cheap-tier signals to extend.
 * @param now  Instant to measure ages against.
 * @returns The enriched signals, or `base` unchanged when nothing was
 *          reachable.
 */
export async function deepSignals(eco: EcoId, name: string, base: ViabilitySignals, now = Date.now()): Promise<ViabilitySignals> {
  return applyDeepMeta(base, await fetchDeepMeta(eco, name), now)
}
