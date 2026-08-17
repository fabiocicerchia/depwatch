// What the last scan found, and who wants to know.
//
// One store, three consumers — the findings pane, the squiggles, the status bar
// — so they can never show three different answers.
//
// Changes are announced once per burst rather than once per scan. Scanning a
// workspace finishes one manifest at a time, and a naive event per manifest had
// every consumer redo its whole job N times: with 25 manifests that is 25 tree
// rebuilds and, worse, 25 x 25 diagnostic republishes, each of them a file read.
// The event carries which paths moved so a consumer can update only those; null
// means "everything", for a clear or a settings change.

import * as vscode from 'vscode'
import { dirname } from 'node:path'
import type { Scan, ScanFailure } from './engine.js'
import { Burst } from './schedule.js'

/** The paths whose results moved, or null when everything did. */
export type ResultsChange = Set<string> | null

// Long enough to swallow a burst of scans, short enough that nobody sees it.
const COALESCE_MS = 150

export class Results implements vscode.Disposable {
  private readonly scans = new Map<string, Scan>()
  private readonly failures = new Map<string, ScanFailure>()
  private readonly changed = new vscode.EventEmitter<ResultsChange>()
  private readonly pending = new Set<string>()
  private readonly burst = new Burst(COALESCE_MS, () => this.emit())
  private wholesale = false
  private sorted: Scan[] | null = null

  readonly onDidChange = this.changed.event

  set(scan: Scan): void {
    this.scans.set(scan.path, scan)
    this.failures.delete(scan.path)
    this.touched(scan.path)
  }

  fail(failure: ScanFailure): void {
    this.failures.set(failure.path, failure)
    this.scans.delete(failure.path)
    this.touched(failure.path)
  }

  remove(path: string): void {
    if (this.scans.delete(path) || this.failures.delete(path)) this.touched(path)
  }

  clear(): void {
    this.scans.clear()
    this.failures.clear()
    this.touched()
  }

  private touched(path?: string): void {
    this.sorted = null
    if (path === undefined) this.wholesale = true
    else this.pending.add(path)
    this.burst.hit()
  }

  private emit(): void {
    const change: ResultsChange = this.wholesale ? null : new Set(this.pending)
    this.pending.clear()
    this.wholesale = false
    this.changed.fire(change)
  }

  get(path: string): Scan | undefined {
    return this.scans.get(path)
  }

  // Sorted once per change rather than once per caller: the tree, the status
  // bar and the report all ask for this on every update.
  all(): Scan[] {
    this.sorted ??= [...this.scans.values()].sort((a, b) => a.label.localeCompare(b.label))
    return this.sorted
  }

  allFailures(): ScanFailure[] {
    return [...this.failures.values()].sort((a, b) => a.label.localeCompare(b.label))
  }

  get size(): number {
    return this.scans.size
  }

  /**
   * The scan a given file belongs to: the manifest itself if that is what was
   * opened, otherwise the nearest manifest above it — so the findings pane has
   * something to say while you are editing source, not just while you are
   * editing package.json.
   */
  forFile(path: string | undefined): Scan | undefined {
    if (!path) return undefined
    const exact = this.scans.get(path)
    if (exact) return exact

    let best: Scan | undefined
    for (const scan of this.scans.values()) {
      const dir = dirname(scan.path)
      if (!isInside(path, dir)) continue
      if (!best || dir.length > dirname(best.path).length) best = scan
    }
    return best
  }

  totals(): { libyears: number; deps: number; replace: number } {
    let libyears = 0
    let deps = 0
    let replace = 0
    for (const scan of this.scans.values()) {
      libyears += scan.report.totalLibyears
      deps += scan.report.deps.length
      replace += scan.report.deps.filter((d) => !d.degraded && d.quadrant === 'replace').length
    }
    return { libyears: Math.round(libyears * 100) / 100, deps, replace }
  }

  dispose(): void {
    this.burst.dispose()
    this.changed.dispose()
  }
}

function isInside(path: string, dir: string): boolean {
  if (!path.startsWith(dir)) return false
  const next = path[dir.length]
  return next === '/' || next === '\\'
}
