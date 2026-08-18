// The findings pane, at the bottom of the window.
//
// Two scopes, one toggle: the manifest the current file belongs to, or every
// manifest in the workspace. Findings are grouped by quadrant and ordered
// worst-first, because the ordering is the advice — the top of this list is
// what to do on Monday. The last row is the bottom line: how much drift, spread
// over how many dependencies.
//
// The whole tree is built once per refresh and kept, rather than rebuilt per
// getChildren call. Two things need that: `reveal` (which expand-all is built
// on) matches elements by identity, and stable ids let VS Code remember which
// groups you had open.

import * as vscode from 'vscode'
import type { DepReport, Report } from '../../../src/report.js'
import type { Config } from './config.js'
import type { Scan } from './engine.js'
import { ORDER, tooltip } from './explain.js'
import type { Results } from './state.js'
import {
  badgeTooltip,
  badgeValue,
  type Lens,
  LENS_BLURB,
  LENS_LABEL,
  LENSES,
  summaryDetail,
  summaryLabel,
  type Totals,
  totalsOf,
} from './totals.js'

export type Scope = 'file' | 'project'

export type Node =
  | { kind: 'file'; scan: Scan }
  | { kind: 'group'; scan: Scan; lens: Lens; deps: DepReport[] }
  | { kind: 'dep'; scan: Scan; dep: DepReport }
  | { kind: 'summary'; totals: Totals; filtered: boolean; accepted: number }
  | { kind: 'message'; text: string; detail?: string }

const ICON: Record<Lens, { icon: string; colour: string }> = {
  replace: { icon: 'flame', colour: 'charts.red' },
  upgrade: { icon: 'arrow-up', colour: 'charts.yellow' },
  watch: { icon: 'eye', colour: 'charts.blue' },
  healthy: { icon: 'check', colour: 'charts.green' },
  degraded: { icon: 'question', colour: 'disabledForeground' },
}

interface Built {
  roots: Node[]
  children: Map<Node, Node[]>
  parents: Map<Node, Node | undefined>
}

export class FindingsTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>()
  private readonly disposables: vscode.Disposable[] = []
  private scope: Scope = 'file'
  // null means everything; a set means only these. Not persisted — a filter is
  // a way of looking at today's list, not a setting.
  private filter: Set<Lens> | null = null
  private built: Built | null = null
  private view: vscode.TreeView<Node> | null = null

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

  /** The view is created after the provider, so it is handed over afterwards. */
  attach(view: vscode.TreeView<Node>): void {
    this.view = view
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

  /** Pass null to show everything again. */
  setFilter(lenses: Set<Lens> | null): void {
    this.filter = lenses && lenses.size > 0 && lenses.size < LENSES.length ? lenses : null
    void vscode.commands.executeCommand('setContext', 'depwatch.filtered', this.filter !== null)
    this.refresh()
  }

  getFilter(): Set<Lens> | null {
    return this.filter
  }

  /** Counts for the current scope, so the filter picker can show them. */
  scopeCounts(): Record<Lens, number> {
    const t = totalsOf(this.scopeReports())
    return { ...t.counts, degraded: t.degraded }
  }

  refresh(): void {
    this.built = null
    this.decorate()
    this.changed.fire(undefined)
  }

  /**
   * VS Code gives a collapse-all button for free and no expand-all, so this is
   * the other half: reveal every root with its descendants. Three is the deepest
   * this tree goes (file → quadrant → dependency) and the most `reveal` takes.
   */
  async expandAll(): Promise<void> {
    const view = this.view
    if (!view) return
    for (const root of this.tree().roots) {
      if (root.kind === 'summary' || root.kind === 'message' || root.kind === 'dep') continue
      await view.reveal(root, { expand: 3, select: false, focus: false })
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'message': {
        const item = new vscode.TreeItem(node.text)
        item.description = node.detail
        item.iconPath = new vscode.ThemeIcon('info')
        return item
      }
      case 'summary': {
        const item = new vscode.TreeItem(summaryLabel(node.totals))
        // Accepted findings are hidden, not gone; saying how many keeps a
        // baselined pane from reading as a clean bill of health.
        item.description = [summaryDetail(node.totals), node.accepted > 0 ? `${node.accepted} accepted` : '']
          .filter(Boolean)
          .join(' · ')
        item.iconPath = new vscode.ThemeIcon('dashboard')
        item.id = 'depwatch.summary'
        item.contextValue = 'depwatch.summary'
        item.tooltip = new vscode.MarkdownString(
          [
            `**${node.totals.libyears.toFixed(2)} libyears** of drift across ${node.totals.deps} dependencies.`,
            '',
            `**${node.totals.toAddress} to address** — everything outside the healthy quadrant.`,
            node.totals.degraded > 0
              ? `${node.totals.degraded} could not be scored and are left out of that count: unknown is not a to-do.`
              : '',
            node.filtered ? '_The list above is filtered. This total is not._' : '',
            node.accepted > 0
              ? `${node.accepted} finding(s) accepted by the baseline are hidden. Clear the baseline to see them.`
              : '',
            `_Behind means over ${this.cfg.thresholds.staleLibyears} libyears; fading means viability under ${this.cfg.thresholds.riskyViability}._`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        )
        return item
      }
      case 'file': {
        const item = new vscode.TreeItem(node.scan.label, vscode.TreeItemCollapsibleState.Expanded)
        item.description = `${node.scan.report.totalLibyears.toFixed(2)} ly · ${node.scan.report.deps.length} deps`
        item.iconPath = new vscode.ThemeIcon('file-code')
        item.resourceUri = vscode.Uri.file(node.scan.path)
        item.id = `file:${node.scan.path}`
        item.contextValue = 'depwatch.file'
        return item
      }
      case 'group': {
        // Only the danger quadrant opens by itself. Everything else would push
        // it off the screen, which is the one thing this pane must not do —
        // expand-all is there when you want the rest.
        const state =
          node.lens === 'replace' || (node.lens === 'upgrade' && node.deps.length <= 10)
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        const item = new vscode.TreeItem(LENS_LABEL[node.lens], state)
        item.description = `${node.deps.length}`
        item.tooltip = LENS_BLURB[node.lens]
        item.iconPath = new vscode.ThemeIcon(ICON[node.lens].icon, new vscode.ThemeColor(ICON[node.lens].colour))
        item.id = `${node.scan.path}:${node.lens}`
        item.contextValue = 'depwatch.group'
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
    const built = this.tree()
    return node ? (built.children.get(node) ?? []) : built.roots
  }

  /** Required for `reveal`, which expand-all is built on. */
  getParent(node: Node): Node | undefined {
    return this.tree().parents.get(node)
  }

  // --- building ---

  private tree(): Built {
    this.built ??= this.build()
    return this.built
  }

  private build(): Built {
    const children = new Map<Node, Node[]>()
    const parents = new Map<Node, Node | undefined>()
    const roots: Node[] = []

    const attach = (parent: Node | undefined, node: Node) => {
      parents.set(node, parent)
      children.set(node, [])
      if (parent) children.get(parent)?.push(node)
      else roots.push(node)
      return node
    }

    const addGroups = (parent: Node | undefined, scan: Scan, groups: GroupNode[]) => {
      for (const group of groups) {
        const node = attach(parent, group)
        for (const dep of group.deps) attach(node, { kind: 'dep', scan, dep })
      }
    }

    const failures = this.results.allFailures()
    const scans = this.scopeScans()

    if (this.results.size === 0) {
      // Nothing at all: no children, so the view's own welcome content shows
      // rather than a row of ours imitating it.
      for (const f of failures) attach(undefined, { kind: 'message', text: f.label, detail: f.message })
      return { roots, children, parents }
    }

    if (scans.length === 0) {
      attach(undefined, {
        kind: 'message',
        text: 'No manifest for the current file',
        detail: 'switch to the project view',
      })
      return { roots, children, parents }
    }

    if (scans.length === 1) {
      addGroups(undefined, scans[0], groupsOf(scans[0], this.filter))
    } else {
      for (const scan of scans) {
        const groups = groupsOf(scan, this.filter)
        if (groups.length === 0) continue // nothing of this file survives the filter
        addGroups(attach(undefined, { kind: 'file', scan }), scan, groups)
      }
    }

    if (this.scope === 'project') {
      for (const f of failures) attach(undefined, { kind: 'message', text: f.label, detail: f.message })
    }

    if (roots.length === 0 && this.filter) {
      attach(undefined, { kind: 'message', text: 'Nothing matches the filter', detail: this.filterLabel() })
    }

    // Last, and never filtered out: it is the total, not a finding.
    attach(undefined, {
      kind: 'summary',
      totals: totalsOf(scans.map((s) => s.report)),
      filtered: this.filter !== null,
      accepted: scans.reduce((n, s) => n + (s.accepted ?? 0), 0),
    })

    return { roots, children, parents }
  }

  private scopeScans(): Scan[] {
    if (this.scope === 'project') return this.results.all()
    const active = vscode.window.activeTextEditor?.document
    const scan = this.results.forFile(active?.uri.scheme === 'file' ? active.uri.fsPath : undefined)
    return scan ? [scan] : []
  }

  private scopeReports(): Report[] {
    return this.scopeScans().map((s) => s.report)
  }

  private filterLabel(): string {
    return this.filter ? [...this.filter].map((l) => LENS_LABEL[l].toLowerCase()).join(', ') : ''
  }

  /**
   * The two things the pane says about itself before you open it: a count on the
   * tab, the way the Problems tab carries one, and a subtitle when a filter is
   * on — so a filtered pane never passes for the whole picture.
   *
   * The badge counts the whole workspace, not the pane's scope, and ignores the
   * filter. Problems does the same, and for the same reason: a number that
   * changed every time you clicked a different file would be noise rather than
   * a thing you could keep half an eye on. The last row of the pane is where
   * the current scope is answered.
   */
  private decorate(): void {
    const view = this.view
    if (!view) return
    view.description = this.filter ? `filtered: ${this.filterLabel()}` : undefined

    const totals = totalsOf(this.results.all().map((s) => s.report))
    const value = badgeValue(this.cfg.badge, totals)
    // Zero is not worth a badge: an empty circle beside the tab reads as a
    // problem, and "nothing to address" is the opposite of one.
    view.badge = value === 0 ? undefined : { value, tooltip: badgeTooltip(this.cfg.badge, totals) }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.changed.dispose()
  }
}

type GroupNode = Extract<Node, { kind: 'group' }>

function groupsOf(scan: Scan, filter: Set<Lens> | null): GroupNode[] {
  const out: GroupNode[] = []
  for (const quadrant of ORDER) {
    if (filter && !filter.has(quadrant)) continue
    const deps = scan.report.deps
      .filter((d) => !d.degraded && d.quadrant === quadrant)
      .sort((a, b) => b.libyearsBehind - a.libyearsBehind || a.viability - b.viability || a.name.localeCompare(b.name))
    if (deps.length > 0) out.push({ kind: 'group', scan, lens: quadrant, deps })
  }
  if (!filter || filter.has('degraded')) {
    const degraded = scan.report.deps.filter((d) => d.degraded)
    if (degraded.length > 0) out.push({ kind: 'group', scan, lens: 'degraded', deps: degraded })
  }
  return out
}

function describe(d: DepReport): string {
  if (d.degraded) return d.degraded
  const bits = [`${d.libyearsBehind.toFixed(2)} ly`, `viability ${d.viability.toFixed(2)}`]
  if (d.latest && d.latest !== d.current) bits.push(`${d.current} → ${d.latest}`)
  return bits.join(' · ')
}
