// Total drift, in the corner. The one number worth carrying around all day.

import * as vscode from 'vscode'
import { gateFailures } from '../../../src/gates.js'
import type { Config } from './config.js'
import type { Results } from './state.js'

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly results: Results,
    private cfg: Config,
  ) {
    this.item.command = 'depwatch.showReport'
    this.disposables.push(this.item, results.onDidChange(() => this.update()))
    this.update()
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg
    this.update()
  }

  scanning(on: boolean): void {
    if (!on) {
      this.update()
      return
    }
    this.item.text = '$(sync~spin) depwatch'
    this.item.tooltip = 'Scanning dependencies'
    this.item.show()
  }

  private update(): void {
    if (!this.cfg.statusBar || this.results.size === 0) {
      this.item.hide()
      return
    }
    const { libyears, deps, replace } = this.results.totals()
    const failures = this.results.all().flatMap((s) => gateFailures(s.report, this.cfg.gates))

    this.item.text = `$(graph) ${libyears.toFixed(2)} ly${replace > 0 ? ` · ${replace} replace` : ''}`
    // Only a failing gate is worth colouring: a big number can be a deliberate
    // choice, a breached budget is not.
    this.item.backgroundColor =
      failures.length > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined

    const lines = [
      `**depwatch** — ${libyears.toFixed(2)} libyears across ${deps} dependencies in ${this.results.size} manifest(s)`,
      replace > 0 ? `${replace} in the replace quadrant: behind and unmaintained` : 'nothing in the replace quadrant',
    ]
    for (const f of failures) lines.push(`- gate: ${f.message}`)
    lines.push('', 'Click for the full report.')

    const tooltip = new vscode.MarkdownString(lines.join('\n\n'))
    this.item.tooltip = tooltip
    this.item.show()
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
