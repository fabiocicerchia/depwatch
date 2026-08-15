// Squiggles and hovers on the manifest itself.
//
// Both need the same thing — where in the file each dependency is written — so
// they share one index, computed once per document version. Editing a manifest
// without saving it therefore costs one re-index of that file and no scan at
// all.

import * as vscode from 'vscode'
import type { DepReport } from '../../../src/report.js'
import { type Config, severityFor } from './config.js'
import { readText, type Scan } from './engine.js'
import { registryUrl, summarise, tooltip } from './explain.js'
import { locateDeps } from './locate.js'
import type { Results } from './state.js'

interface Indexed {
  version: number
  ranges: Map<string, vscode.Range>
}

export class Annotator implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('depwatch')
  private readonly index = new Map<string, Indexed>()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly results: Results,
    private cfg: Config,
  ) {
    this.disposables.push(
      this.collection,
      results.onDidChange(() => void this.refresh()),
      // A manifest opened after its scan still gets its squiggles.
      vscode.workspace.onDidOpenTextDocument((doc) => void this.publish(doc.uri.fsPath)),
      // The offsets move as you type; the findings do not change until a save.
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.index.has(e.document.uri.fsPath)) void this.publish(e.document.uri.fsPath)
      }),
      vscode.languages.registerHoverProvider(
        [{ scheme: 'file', pattern: '**/*' }],
        { provideHover: (doc, pos) => this.hover(doc, pos) },
      ),
    )
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg
    void this.refresh()
  }

  async refresh(): Promise<void> {
    this.collection.clear()
    if (!this.cfg.diagnostics) return
    for (const scan of this.results.all()) await this.publish(scan.path, scan)
  }

  private async publish(path: string, known?: Scan): Promise<void> {
    const scan = known ?? this.results.get(path)
    if (!scan || !this.cfg.diagnostics) return

    const ranges = await this.rangesFor(scan)
    const diagnostics: vscode.Diagnostic[] = []
    for (const dep of scan.report.deps) {
      const range = ranges.get(dep.name)
      if (!range) continue // a transitive dep, written down nowhere in this file
      const severity = severityFor(this.cfg, dep.quadrant, Boolean(dep.degraded))
      if (severity === null) continue
      diagnostics.push(this.diagnostic(dep, range, severity, scan))
    }
    this.collection.set(vscode.Uri.file(scan.path), diagnostics)
  }

  private diagnostic(
    dep: DepReport,
    range: vscode.Range,
    severity: vscode.DiagnosticSeverity,
    scan: Scan,
  ): vscode.Diagnostic {
    const d = new vscode.Diagnostic(range, summarise(dep, this.cfg.thresholds), severity)
    d.source = 'depwatch'
    const url = registryUrl(dep.ecosystem ?? scan.report.ecosystem, dep.name)
    // The code doubles as a link out to the registry, so the Problems panel can
    // take you to the package rather than just naming it.
    d.code = url ? { value: dep.degraded ? 'no-data' : dep.quadrant, target: vscode.Uri.parse(url) } : dep.quadrant
    return d
  }

  private async hover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const scan = this.results.get(doc.uri.fsPath)
    if (!scan) return undefined
    const ranges = await this.rangesFor(scan, doc)
    for (const dep of scan.report.deps) {
      const range = ranges.get(dep.name)
      if (!range?.contains(pos)) continue
      const md = new vscode.MarkdownString(tooltip(dep, this.cfg.thresholds, scan.report.ecosystem))
      md.supportHtml = false
      return new vscode.Hover(md, range)
    }
    return undefined
  }

  private async rangesFor(scan: Scan, doc?: vscode.TextDocument): Promise<Map<string, vscode.Range>> {
    const open = doc ?? vscode.workspace.textDocuments.find((d) => d.uri.fsPath === scan.path)
    const version = open?.version ?? -1
    const cached = this.index.get(scan.path)
    if (cached && cached.version === version) return cached.ranges

    const text = open?.getText() ?? (await readText(scan.path))
    if (text === undefined) return new Map()

    const spans = locateDeps(text, scan.path, scan.report.deps.map((d) => d.name))
    const lines = new LineIndex(text)
    const ranges = new Map<string, vscode.Range>()
    for (const [name, span] of spans) {
      ranges.set(name, new vscode.Range(lines.positionAt(span.start), lines.positionAt(span.end)))
    }
    this.index.set(scan.path, { version, ranges })
    return ranges
  }

  forget(path: string): void {
    this.index.delete(path)
    this.collection.delete(vscode.Uri.file(path))
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}

/**
 * Offsets to positions without a TextDocument — the manifest that produced a
 * finding is often not open, and its diagnostics still belong in the Problems
 * panel.
 */
class LineIndex {
  private readonly starts: number[] = [0]

  constructor(text: string) {
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.starts.push(i + 1)
  }

  positionAt(offset: number): vscode.Position {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return new vscode.Position(lo, offset - this.starts[lo])
  }
}
