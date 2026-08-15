// What the last scan found, and who wants to know.
//
// One store, three consumers — the findings pane, the squiggles, the status bar
// — so they can never show three different answers.

import * as vscode from 'vscode'
import { dirname } from 'node:path'
import type { Scan, ScanFailure } from './engine.js'

export class Results implements vscode.Disposable {
  private readonly scans = new Map<string, Scan>()
  private readonly failures = new Map<string, ScanFailure>()
  private readonly changed = new vscode.EventEmitter<void>()

  readonly onDidChange = this.changed.event

  set(scan: Scan): void {
    this.scans.set(scan.path, scan)
    this.failures.delete(scan.path)
    this.changed.fire()
  }

  fail(failure: ScanFailure): void {
    this.failures.set(failure.path, failure)
    this.scans.delete(failure.path)
    this.changed.fire()
  }

  remove(path: string): void {
    if (this.scans.delete(path) || this.failures.delete(path)) this.changed.fire()
  }

  clear(): void {
    this.scans.clear()
    this.failures.clear()
    this.changed.fire()
  }

  get(path: string): Scan | undefined {
    return this.scans.get(path)
  }

  all(): Scan[] {
    return [...this.scans.values()].sort((a, b) => a.label.localeCompare(b.label))
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
    this.changed.dispose()
  }
}

function isInside(path: string, dir: string): boolean {
  if (!path.startsWith(dir)) return false
  const next = path[dir.length]
  return next === '/' || next === '\\'
}
