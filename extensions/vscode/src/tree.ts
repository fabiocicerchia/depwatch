// The findings pane, at the bottom of the window.
//
// Two scopes, one toggle: the manifest the current file belongs to, or every
// manifest in the workspace. Findings are grouped by quadrant and ordered
// worst-first, because the ordering is the advice — the top of this list is
// what to do on Monday.

import * as vscode from 'vscode'
import type { DepReport, Quadrant } from '../../../src/report.js'
import type { Config } from './config.js'
import type { Scan } from './engine.js'
import { ORDER, QUADRANT, tooltip } from './explain.js'
import type { Results } from './state.js'

export type Scope = 'file' | 'project'

type Node =
  | { kind: 'file'; scan: Scan }
  | { kind: 'group'; scan: Scan; quadrant: Quadrant | 'degraded'; deps: DepReport[] }
  | { kind: 'dep'; scan: Scan; dep: DepReport }
  | { kind: 'message'; text: string; detail?: string }

const ICON: Record<Quadrant | 'degraded', { icon: string; colour: string }> = {
  replace: { icon: 'flame', colour: 'charts.red' },
  upgrade: { icon: 'arrow-up', colour: 'charts.yellow' },
  watch: { icon: 'eye', colour: 'charts.blue' },
  healthy: { icon: 'check', colour: 'charts.green' },
  degraded: { icon: 'question', colour: 'disabledForeground' },
}

export class FindingsTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>()
  private readonly disposables: vscode.Disposable[] = []
  private scope: Scope = 'file'

  readonly onDidChangeTreeData = this.changed.event

  constructor(
    private readonly results: Results,
    private cfg: Config,
  ) {
    this.disposables.push(
      results.onDidChange(() => this.refresh()),
      // Switching file changes what "current file" means, but never triggers a
      // scan — this is a re-filter of results already in hand.
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this.scope === 'file') this.refresh()
      }),
    )
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg
    this.refresh()
  }

  setScope(scope: Scope): void {
    this.scope = scope
    void vscode.commands.executeCommand('setContext', 'depwatch.scope', scope)
    this.refresh()
  }

  getScope(): Scope {
    return this.scope
  }

  refresh(): void {
    this.changed.fire(undefined)
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'message': {
        const item = new vscode.TreeItem(node.text)
        item.description = node.detail
        item.iconPath = new vscode.ThemeIcon('info')
        return item
      }
      case 'file': {
        const item = new vscode.TreeItem(node.scan.label, vscode.TreeItemCollapsibleState.Expanded)
        item.description = `${node.scan.report.totalLibyears.toFixed(2)} ly · ${node.scan.report.deps.length} deps`
        item.iconPath = new vscode.ThemeIcon('file-code')
        item.resourceUri = vscode.Uri.file(node.scan.path)
        item.contextValue = 'depwatch.file'
        return item
      }
      case 'group': {
        const info = node.quadrant === 'degraded' ? null : QUADRANT[node.quadrant]
        const label = info ? info.label : 'no data'
        // Only the danger quadrant opens by itself. Everything else would push
        // it off the screen, which is the one thing this pane must not do.
        const state =
          node.quadrant === 'replace' || (node.quadrant === 'upgrade' && node.deps.length <= 10)
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        const item = new vscode.TreeItem(label, state)
        item.description = `${node.deps.length}`
        item.tooltip = info?.blurb ?? 'the registry did not answer for these packages'
        const look = ICON[node.quadrant]
        item.iconPath = new vscode.ThemeIcon(look.icon, new vscode.ThemeColor(look.colour))
        item.id = `${node.scan.path}:${node.quadrant}`
        return item
      }
      case 'dep': {
        const d = node.dep
        const item = new vscode.TreeItem(d.name)
        item.description = describe(d)
        item.tooltip = new vscode.MarkdownString(tooltip(d, this.cfg.thresholds, node.scan.report.ecosystem))
        const look = ICON[d.degraded ? 'degraded' : d.quadrant]
        item.iconPath = new vscode.ThemeIcon(look.icon, new vscode.ThemeColor(look.colour))
        item.contextValue = 'depwatch.dep'
        item.id = `${node.scan.path}:${d.name}`
        item.command = {
          command: 'depwatch.reveal',
          title: 'Reveal in the manifest',
          arguments: [node.scan.path, d.name],
        }
        return item
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots()
    if (node.kind === 'file') return groups(node.scan)
    if (node.kind === 'group') return node.deps.map((dep) => ({ kind: 'dep', scan: node.scan, dep }))
    return []
  }

  private roots(): Node[] {
    const failures = this.results.allFailures()
    if (this.results.size === 0) {
      // Nothing at all: return no children so the view's own welcome content
      // shows, rather than a row of ours imitating it.
      return failures.map((f) => ({ kind: 'message', text: f.label, detail: f.message }))
    }

    if (this.scope === 'project') {
      const scans = this.results.all()
      const nodes: Node[] = scans.length === 1 ? groups(scans[0]) : scans.map((scan) => ({ kind: 'file', scan }))
      for (const f of failures) nodes.push({ kind: 'message', text: f.label, detail: f.message })
      return nodes
    }

    const active = vscode.window.activeTextEditor?.document
    const scan = this.results.forFile(active?.uri.scheme === 'file' ? active.uri.fsPath : undefined)
    if (!scan) {
      return [{ kind: 'message', text: 'No manifest for the current file', detail: 'switch to the project view' }]
    }
    return groups(scan)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.changed.dispose()
  }
}

function groups(scan: Scan): Node[] {
  const out: Node[] = []
  for (const quadrant of ORDER) {
    const deps = scan.report.deps
      .filter((d) => !d.degraded && d.quadrant === quadrant)
      .sort((a, b) => b.libyearsBehind - a.libyearsBehind || a.viability - b.viability || a.name.localeCompare(b.name))
    if (deps.length > 0) out.push({ kind: 'group', scan, quadrant, deps })
  }
  const degraded = scan.report.deps.filter((d) => d.degraded)
  if (degraded.length > 0) out.push({ kind: 'group', scan, quadrant: 'degraded', deps: degraded })
  return out
}

function describe(d: DepReport): string {
  if (d.degraded) return d.degraded
  const bits = [`${d.libyearsBehind.toFixed(2)} ly`, `viability ${d.viability.toFixed(2)}`]
  if (d.latest && d.latest !== d.current) bits.push(`${d.current} → ${d.latest}`)
  return bits.join(' · ')
}
