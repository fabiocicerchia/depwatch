// The report, in a tab.
//
// Same page the exported HTML produces, with two things a file cannot have: it
// follows the editor's theme, and clicking a row jumps to that dependency in
// the manifest.

import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { gateFailures, tally } from '../../../src/gates.js'
import { quadrantSVG } from '../../../src/quadrant.js'
import type { TrendPoint } from '../../../src/trend.js'
import type { Config } from './config.js'
import { type ManifestView, reportHtml, type ReportView, trendHtml } from './html.js'
import { Burst } from './schedule.js'
import type { Results } from './state.js'

// A scan publishes partial results several times a second. Rebuilding the page
// that often is not just wasted work — N quadrant SVGs and N full tables per
// rebuild — it also throws away the scroll position and the column sort every
// time, which makes the report unreadable for as long as the scan runs. Leading
// edge, so the first results still appear at once.
const RENDER_MS = 1000

export class ReportPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null
  private readonly disposables: vscode.Disposable[] = []
  private readonly burst = new Burst(RENDER_MS, () => this.render())

  constructor(
    private readonly results: Results,
    private cfg: Config,
  ) {
    // A scan that lands while the report is open updates it in place; one that
    // lands while it is closed does nothing at all.
    this.disposables.push(results.onDidChange(() => this.burst.hit()))
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg
    this.render()
  }

  show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('depwatch.report', 'depwatch report', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: false, // it is cheap to rebuild; memory is not
      })
      this.panel.onDidDispose(() => {
        this.panel = null
      })
      // retainContextWhenHidden is off, so a hidden panel has no webview to
      // update — whatever it missed is built once, when it comes back.
      this.panel.onDidChangeViewState(() => this.render())
      this.panel.webview.onDidReceiveMessage((msg: { type: string; file?: string; dep?: string }) => {
        if (msg.type === 'reveal' && msg.file && msg.dep) {
          void vscode.commands.executeCommand('depwatch.reveal', msg.file, msg.dep)
        }
      })
    }
    // Revealed first: render is a no-op on a hidden panel, and this is the call
    // that makes it visible.
    this.panel.reveal()
    this.render()
  }

  /** The same page, as a standalone file: no script, no CSP, opens in a browser. */
  export(): string {
    return reportHtml(this.view())
  }

  private render(): void {
    if (!this.panel?.visible) return
    const nonce = randomBytes(16).toString('base64')
    this.panel.webview.html = reportHtml(this.view(), { nonce, cspSource: this.panel.webview.cspSource })
  }

  private view(): ReportView {
    const manifests: ManifestView[] = this.results.all().map((scan) => ({
      label: scan.label,
      path: scan.path,
      report: scan.report,
      notes: scan.notes,
      counts: tally(scan.report),
      svg: quadrantSVG(scan.report.deps, {
        title: `${scan.report.file} — drift × viability (${scan.report.totalLibyears.toFixed(2)} libyears)`,
        thresholds: this.cfg.thresholds,
      }),
    }))

    return {
      manifests,
      failures: this.results.allFailures().map((f) => ({ label: f.label, message: f.message })),
      gates: this.gates(),
      gatesConfigured: this.cfg.gatesConfigured,
      thresholds: this.cfg.thresholds,
      deep: this.results.all().every((s) => s.deep) && this.results.size > 0,
      generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    }
  }

  // Gates are per-manifest — a workspace-wide total would fail a budget the
  // author set for one package — so each manifest is judged on its own and the
  // failures are labelled with the file they came from.
  private gates() {
    return this.results.all().flatMap((scan) =>
      gateFailures(scan.report, this.cfg.gates).map((f) => ({
        ...f,
        message: `${scan.label}: ${f.message}`,
      })),
    )
  }

  dispose(): void {
    this.burst.dispose()
    this.panel?.dispose()
    for (const d of this.disposables) d.dispose()
  }
}

/** Trend gets its own tab: it answers a different question and is asked rarely. */
export function showTrend(file: string, points: TrendPoint[]): void {
  const panel = vscode.window.createWebviewPanel('depwatch.trend', `depwatch trend — ${file}`, vscode.ViewColumn.Active, {
    enableScripts: false,
  })
  panel.webview.html = trendHtml(file, points)
}
