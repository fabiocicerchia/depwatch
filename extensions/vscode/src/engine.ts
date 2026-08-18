// Running depwatch, from the editor.
//
// The engine is imported, not shelled out to: no process to spawn per save, one
// cache shared by every manifest in the workspace, and typed reports instead of
// parsed stdout. The CLI and this extension therefore cannot disagree about a
// number — they run the same code.
//
// Three things stop a scan from being expensive, in the order they get a
// chance to:
//
//   0. the file stamps — mtime and size, or the document version when the file
//      is open. Unchanged means the previous parse is reused: reading and
//      JSON.parsing a megabyte lock file costs about 10ms of blocking work on
//      the extension host thread, and two stat calls cost 0.004ms;
//   1. the dependency signature — if the deps and their versions are the same
//      as last time and the result is younger than the refresh interval, the
//      previous report is returned and nothing else runs at all;
//   2. the TTL cache in cache.ts — a version list already on disk is not
//      fetched again;
//   3. concurrency limiting, in the engine itself.
//
// Files are read through the editor first and the disk second, so scanning a
// manifest you have open costs no disk read.

import * as vscode from 'vscode'
import { dirname, join } from 'node:path'
import type { DeepMeta } from '../../../src/signals.js'
import type { PackageInfo, RegistryError } from '@lib/registry-client'
import { type InputFs, loadManifest } from '../../../src/input.js'
import { basename, detectEcosystem, LOCK_FOR, type Manifest } from '../../../src/manifest.js'
import { analyse, type AnalyseCache, type Report } from '../../../src/report.js'
import { TtlCache } from './cache.js'
import { combine, isExcludedPath } from './exclude.js'
import { Coalescer } from './schedule.js'
import { FileCacheStore } from './store.js'
import type { Config } from './config.js'

export interface Scan {
  path: string
  label: string
  report: Report
  notes: string[]
  deep: boolean
  scannedAt: number
  /** The deps and versions this report was computed from. */
  signature: string
}

export interface ScanFailure {
  path: string
  label: string
  message: string
}

/** The previous scan of a manifest, and what it was computed from. */
interface Remembered {
  scan: Scan
  manifest: Manifest
  /** mtime and size of every file that fed the parse, or the editor's version. */
  stamps: string
}

export class Scanner {
  private readonly packages: TtlCache<PackageInfo | RegistryError>
  private readonly deepMeta: TtlCache<DeepMeta>
  private readonly coalescer = new Coalescer<Scan>()
  private readonly previous = new Map<string, Remembered>()

  constructor(storage: vscode.Uri, private readonly cfg: Config) {
    this.packages = new TtlCache({
      store: new FileCacheStore(vscode.Uri.joinPath(storage, 'registry')),
      ttlMs: cfg.registryTtlMs,
      isFailure: (value) => 'error' in value,
      maxInMemory: cfg.maxInMemory,
    })
    this.deepMeta = new TtlCache({
      store: new FileCacheStore(vscode.Uri.joinPath(storage, 'deep')),
      ttlMs: cfg.deepTtlMs,
      maxInMemory: cfg.maxInMemory,
    })
  }

  /**
   * Scan one manifest. `force` skips the signature short-circuit — the periodic
   * refresh uses it to look for releases published since the last scan, and
   * leaves the TTL cache to decide whether that costs a request.
   */
  scan(path: string, opts: { deep: boolean; force?: boolean } = { deep: false }): Promise<Scan> {
    return this.coalescer.run(path, async () => {
      const label = vscode.workspace.asRelativePath(path)
      const inputs = candidates(path, this.cfg)
      const stamps = await stampsOf(inputs)
      const last = this.previous.get(path)

      // Nothing on disk moved, so the last parse still describes these files.
      // The periodic refresh takes this path every time: it exists to re-ask the
      // registries, not to re-read a lock file that has not changed.
      let manifest: Manifest
      let notes: string[]
      if (last && last.stamps === stamps) {
        manifest = last.manifest
        notes = last.scan.notes
      } else {
        const loaded = loadManifest(path, {
          fs: await snapshot(inputs),
          noLock: !this.cfg.useLockFile,
          transitive: this.cfg.transitive,
        })
        manifest = loaded.manifest
        notes = loaded.notes
      }

      const deep = opts.deep || this.cfg.deep
      const signature = signatureOf(manifest.deps, deep, this.cfg)
      if (!opts.force && last && last.scan.signature === signature && this.isFresh(last.scan)) return last.scan

      const report = await analyse(manifest, {
        deep,
        thresholds: this.cfg.thresholds,
        concurrency: this.cfg.concurrency,
        cache: this.cache(),
      })

      const scan: Scan = { path, label, report, notes, deep, scannedAt: Date.now(), signature }
      this.previous.set(path, { scan, manifest, stamps })
      return scan
    })
  }

  private isFresh(scan: Scan): boolean {
    // With the timer off, a report only goes stale when the manifest changes —
    // which the signature already caught.
    if (this.cfg.refreshMs <= 0) return true
    return Date.now() - scan.scannedAt < this.cfg.refreshMs
  }

  private cache(): AnalyseCache {
    return {
      packages: (key, load) => this.packages.wrap(key, load),
      deep: (key, load) => this.deepMeta.wrap(key, load),
    }
  }

  /** Anything the caches queued, written out. Called on deactivate. */
  async flush(): Promise<void> {
    await Promise.all([this.packages.flush(), this.deepMeta.flush()])
  }

  async prune(): Promise<void> {
    await Promise.all([this.packages.prune(this.cfg.maxEntries), this.deepMeta.prune(this.cfg.maxEntries)])
  }

  async clear(): Promise<void> {
    this.previous.clear()
    await Promise.all([this.packages.clear(), this.deepMeta.clear()])
  }

  forget(path: string): void {
    this.previous.delete(path)
  }
}

// Everything that would change the numbers. Thresholds are in here because they
// decide the quadrant, and the quadrant is what the report is for.
function signatureOf(deps: { name: string; current: string; ecosystem?: string }[], deep: boolean, cfg: Config): string {
  const list = deps
    .map((d) => `${d.ecosystem ?? ''}:${d.name}@${d.current}`)
    .sort()
    .join(',')
  return `${deep ? 'deep' : 'cheap'}|${cfg.thresholds.staleLibyears}|${cfg.thresholds.riskyViability}|${list}`
}

/** The manifest, plus the lock files that could sit beside it. */
function candidates(path: string, cfg: Config): string[] {
  const paths = new Set([path])
  if (cfg.useLockFile) {
    const eco = detectEcosystem(path)
    if (eco) for (const lock of LOCK_FOR[eco]) paths.add(join(dirname(path), lock))
  }
  return [...paths]
}

/**
 * A cheap fingerprint of the inputs: mtime and size from a stat, or the
 * editor's document version when the file is open — because an unsaved buffer
 * is what would actually be read, and the disk's timestamp says nothing about
 * it.
 */
async function stampsOf(paths: string[]): Promise<string> {
  const stamps = await Promise.all(
    paths.map(async (path) => {
      const open = openDocument(path)
      if (open) return `${path}@doc:${open.version}`
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path))
        return `${path}@fs:${stat.mtime}:${stat.size}`
      } catch {
        return `${path}@absent`
      }
    }),
  )
  return stamps.join('|')
}

/**
 * The files, read once. The editor's copy wins over the disk's — it is both
 * fresher and free.
 */
async function snapshot(paths: string[]): Promise<InputFs> {
  const files = new Map<string, string>()
  await Promise.all(
    paths.map(async (candidate) => {
      const text = await readText(candidate)
      if (text !== undefined) files.set(candidate, text)
    }),
  )

  return {
    exists: (p) => files.has(p),
    read: (p) => {
      const text = files.get(p)
      if (text === undefined) throw new Error(`${basename(p)} could not be read`)
      return text
    },
  }
}

const openDocument = (path: string): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === path)

export async function readText(path: string): Promise<string | undefined> {
  const open = openDocument(path)
  if (open) return open.getText()
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path)))
  } catch {
    return undefined
  }
}

/**
 * The manifests worth scanning, capped. Discovery is a glob against the
 * editor's own file index — no directory walk of our own.
 */
export async function findManifests(cfg: Config): Promise<string[]> {
  const found = new Set<string>()
  for (const glob of cfg.manifests) {
    const uris = await vscode.workspace.findFiles(glob, combine(cfg.excludeGlobs), cfg.maxManifests * 2)
    for (const uri of uris) if (uri.scheme === 'file') found.add(uri.fsPath)
    if (found.size >= cfg.maxManifests) break
  }
  // Shallowest first: in a monorepo the root manifest is the one someone means.
  return [...found].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, cfg.maxManifests)
}

const depth = (path: string) => path.split(/[/\\]/).length

/**
 * Whether a path sits somewhere excluded. Used on file events, where
 * `findFiles` has not had a say — a package.json under node_modules is still a
 * package.json, and there are forty thousand of them.
 */
export function isExcluded(path: string, cfg: Config): boolean {
  return isExcludedPath(path, cfg.excludedDirs)
}

/** Is this a file we would scan, or one that feeds a scan (a lock file)? */
export function isScannable(path: string, cfg: Config): boolean {
  const base = basename(path)
  if (Object.values(LOCK_FOR).some((locks) => locks.includes(base))) return true
  return cfg.manifests.some((glob) => matches(base, glob))
}

// Only the basename part of the glob is compared: discovery has already decided
// which directories are in scope, and this is asked about a file that changed.
function matches(base: string, glob: string): boolean {
  const tail = glob.split('/').pop() ?? glob
  const pattern = tail
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${pattern}$`).test(base)
}

/** The lock file a changed path belongs to, so saving a lock rescans its manifest. */
export function manifestForLock(path: string, candidates: string[]): string[] {
  const dir = dirname(path)
  return candidates.filter((c) => dirname(c) === dir)
}
