// Trend mode: is the manifest getting fresher or staler over time?
//
// Release dates are historical facts, so every past point is computable from
// today's registry data — walk the manifest's git history, and for each revision
// score it as of that commit's date. No time machine needed, and (thanks to the
// package cache in report.ts) no extra registry traffic per commit.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { analyse, type AnalyseOptions } from './report.js'
import { parse, type SupportedEcosystem } from './manifest.js'

const exec = promisify(execFile)

export interface TrendPoint {
  commit: string
  date: string
  totalLibyears: number
  deps: number
  replace: number // deps in the danger quadrant at that commit
}

// git is the only binary depwatch shells out to. Without it execFile fails with
// a bare "spawn git ENOENT", which names the problem and not the fix — so say
// the command instead, and keep the ENOENT code on the way out so a caller with
// a UI (the extension) can offer to run it. Every git call goes through here.
export const INSTALL_GIT =
  process.platform === 'darwin'
    ? 'brew install git'
    : process.platform === 'win32'
      ? 'winget install --id Git.Git'
      : 'sudo apt install git'

export const isMissingGit = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT'

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (e: unknown) {
    if (!isMissingGit(e)) throw e
    throw Object.assign(new Error(`git is not installed. Install it with: ${INSTALL_GIT}`), { code: 'ENOENT' })
  }
}

export interface TrendOptions extends AnalyseOptions {
  maxPoints?: number
  cwd?: string
}

/**
 * Scores a manifest at points through its own git history.
 *
 * Release dates are historical facts, so every past point is computable from
 * today's registry data: walk the manifest's history and score each revision as
 * of that commit's date. No time machine, and — thanks to the package cache —
 * no extra registry traffic per commit.
 *
 * Commits are sampled evenly rather than truncated, so a manifest with 400 of
 * them still produces a readable series across its whole life.
 *
 * @param file      Path to the manifest, relative to the repository.
 * @param ecosystem Overrides detection.
 * @param opts      `maxPoints` (default 12), `cwd`, and the analyse options.
 * @returns One point per sampled commit, oldest first.
 * @throws When the file has no git history.
 */
export async function trend(file: string, ecosystem: SupportedEcosystem | undefined, opts: TrendOptions = {}): Promise<TrendPoint[]> {
  const cwd = opts.cwd ?? process.cwd()
  const max = opts.maxPoints ?? 12

  const log = await git(['log', '--follow', '--format=%H%x00%cI', '--', file], cwd)
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [commit, date] = l.split('\0')
      return { commit, date }
    })

  if (commits.length === 0) throw new Error(`no git history for ${file}`)

  // Newest first from git log; sample evenly so a manifest with 400 commits
  // still produces a readable series, then report oldest → newest.
  const stride = Math.max(1, Math.ceil(commits.length / max))
  const sampled = commits.filter((_, i) => i % stride === 0).slice(0, max).reverse()

  const points: TrendPoint[] = []
  for (const { commit, date } of sampled) {
    let text: string
    try {
      text = await git(['show', `${commit}:${file}`], cwd)
    } catch {
      continue // the path was different at that commit (rename); --follow lists it, show cannot
    }
    const manifest = parse(file, text, ecosystem)
    const report = await analyse(manifest, { ...opts, asOf: Date.parse(date) })
    points.push({
      commit: commit.slice(0, 8),
      date,
      totalLibyears: report.totalLibyears,
      deps: report.deps.length,
      replace: report.deps.filter((d) => d.quadrant === 'replace').length,
    })
  }
  return points
}
