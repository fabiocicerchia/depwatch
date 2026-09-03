// The baseline, as a file in the workspace.
//
// It lives in the repository rather than in settings so it can be committed and
// shared: "we accept this much drift today" is a team decision, not a
// per-machine one. It is applied here rather than in the scanner, so writing a
// baseline re-filters what is already in hand instead of costing a rescan.

import * as vscode from 'vscode'
import { acceptedIn, type Baseline, parse, serialise, withoutAccepted } from '../../../src/baseline.js'
import type { Config } from './config.js'
import type { Scan } from './engine.js'

export class WorkspaceBaseline {
  private accepted: Baseline | null = null

  constructor(
    private cfg: Config,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  setConfig(cfg: Config): void {
    this.cfg = cfg
  }

  /** Where it lives, or undefined when there is no workspace folder for it. */
  uri(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0]
    return folder && vscode.Uri.joinPath(folder.uri, this.cfg.baselinePath)
  }

  /** Re-read it. No file at all is the normal case, not an error. */
  async load(): Promise<void> {
    const uri = this.uri()
    if (!uri) return
    try {
      this.accepted = parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)))
      const manifests = this.accepted && Object.keys(this.accepted.manifests).length
      this.log.debug(this.accepted ? `baseline: ${manifests} manifest(s)` : 'baseline: unreadable')
    } catch {
      this.accepted = null
    }
  }

  forget(): void {
    this.accepted = null
  }

  /** One scan, with everything the baseline already accounts for taken out. */
  apply(scan: Scan): Scan {
    const hidden = acceptedIn(this.accepted, scan.label, scan.report)
    if (hidden.size === 0) return scan
    return { ...scan, report: withoutAccepted(scan.report, hidden), accepted: hidden.size }
  }

  /** Accept these scans wholesale, and re-read what was written. */
  async write(uri: vscode.Uri, scans: Scan[]): Promise<void> {
    const text = serialise(scans, new Date().toISOString())
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text))
    await this.load()
  }
}

/** Findings a fresh set of scans is about to accept. */
export function acceptableCount(scans: Scan[]): number {
  return scans.reduce((n, s) => n + s.report.deps.filter((d) => d.quadrant !== 'healthy' && !d.degraded).length, 0)
}
