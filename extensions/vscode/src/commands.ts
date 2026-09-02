// Every command the extension contributes.
//
// The ids and their titles are a public contract — package.json declares them,
// keybindings and the palette use them, and the pane's title bar wires them to
// its icons — so this file registers exactly the list in `contributes.commands`
// plus depwatch.reveal, which the webview calls and nobody types.
//
// Handlers take what they need through `CommandDeps` rather than closing over
// activate()'s locals: the two that change under them (the configuration and
// the scanner, both rebuilt when settings move) come in as getters, so a
// command always runs against the current one.

import * as vscode from 'vscode'
import { relative } from 'node:path'
import { basename } from '../../../src/manifest.js'
import { quadrantSVG } from '../../../src/quadrant.js'
import { gateFailures } from '../../../src/gates.js'
import { INSTALL_GIT, isMissingGit, trend } from '../../../src/trend.js'
import { acceptableCount, type WorkspaceBaseline } from './baseline-file.js'
import type { Config } from './config.js'
import { findManifests, isScannable, type Scanner } from './engine.js'
import { locateDeps } from './locate.js'
import { type ReportPanel, showTrend } from './panel.js'
import type { Results } from './state.js'
import { LENS_BLURB, LENS_LABEL, LENSES } from './totals.js'
import type { FindingsTree } from './tree.js'

export interface CommandDeps {
  log: { show(): void }
  results: Results
  tree: FindingsTree
  panel: ReportPanel
  baseline: WorkspaceBaseline
  secrets: vscode.SecretStorage
  /** The current configuration; rebuilt whenever settings change. */
  cfg: () => Config
  /** The current scanner; rebuilt whenever settings change. */
  scanner: () => Scanner
  scanOne: (path: string, opts?: { deep?: boolean; force?: boolean }) => Promise<void>
  scanAll: (opts?: { deep?: boolean; force?: boolean; quiet?: boolean }) => Promise<void>
  /** Abort the running scan; false when there was none. */
  cancel: () => boolean
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { log, results, tree, panel, baseline, cfg, scanner, scanOne, scanAll } = deps

  const register = (name: string, run: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, run))

  async function activeManifest(): Promise<string | undefined> {
    const active = vscode.window.activeTextEditor?.document
    if (active?.uri.scheme === 'file' && isScannable(active.uri.fsPath, cfg())) return active.uri.fsPath

    const candidates = results.size > 0 ? results.all().map((s) => s.path) : await findManifests(cfg())
    if (candidates.length === 0) {
      vscode.window.showWarningMessage('depwatch: no dependency manifest found.')
      return undefined
    }
    if (candidates.length === 1) return candidates[0]
    return vscode.window
      .showQuickPick(
        candidates.map((path) => ({ label: vscode.workspace.asRelativePath(path), path })),
        { title: 'Which manifest?' },
      )
      .then((pick) => pick?.path)
  }

  // --- scanning ---

  register('depwatch.scanWorkspace', () => scanAll())
  register('depwatch.deepScan', () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'depwatch: deep scan' },
      () => scanAll({ deep: true, force: true }),
    ),
  )
  register('depwatch.scanFile', async () => {
    const path = await activeManifest()
    if (path) await scanOne(path, { force: true })
  })

  register('depwatch.cancel', () => {
    if (!deps.cancel()) vscode.window.showInformationMessage('depwatch: no scan is running.')
  })

  register('depwatch.clearCache', async () => {
    await scanner().clear()
    results.clear()
    vscode.window.showInformationMessage('depwatch: registry cache cleared. The next scan will refetch.')
  })

  // --- the pane ---

  register('depwatch.setScopeFile', () => tree.setScope('file'))
  register('depwatch.setScopeProject', () => tree.setScope('project'))
  register('depwatch.expandAll', () => tree.expandAll())
  register('depwatch.showLog', () => log.show())
  register('depwatch.clearFilter', () => tree.setFilter(null))

  // A multi-select quick pick rather than a row of toggle buttons: five
  // quadrants would be five more icons in a title bar that already has enough,
  // and the counts belong next to the choice.
  register('depwatch.filterFindings', async () => {
    const counts = tree.scopeCounts()
    const active = tree.getFilter()
    const items = LENSES.map((lens) => ({
      label: LENS_LABEL[lens],
      description: `${counts[lens]} ${counts[lens] === 1 ? 'dep' : 'deps'}`,
      detail: LENS_BLURB[lens],
      lens,
      picked: active ? active.has(lens) : true,
    }))
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Show findings for',
      placeHolder: 'Pick the quadrants to show — none picked shows everything',
    })
    if (!picked) return // cancelled: leave the filter alone
    tree.setFilter(picked.length === 0 ? null : new Set(picked.map((p) => p.lens)))
  })

  register('depwatch.reveal', async (path: string, dep: string) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    const editor = await vscode.window.showTextDocument(doc, { preview: true })
    const span = locateDeps(doc.getText(), path, [dep]).get(dep)
    if (!span) return
    const range = new vscode.Range(doc.positionAt(span.start), doc.positionAt(span.end))
    editor.selection = new vscode.Selection(range.start, range.end)
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  })

  // --- the report ---

  register('depwatch.showReport', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    panel.show()
  })

  register('depwatch.checkGates', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    if (!cfg().gatesConfigured) {
      const pick = await vscode.window.showInformationMessage(
        'depwatch: no gates configured. Set depwatch.gates.maxLibyears or depwatch.gates.maxReplace to fail on a budget, the same way depwatch check --ci does.',
        'Open settings',
      )
      if (pick) await vscode.commands.executeCommand('workbench.action.openSettings', 'depwatch.gates')
      return
    }
    const failures = results
      .all()
      .flatMap((s) => gateFailures(s.report, cfg().gates).map((f) => `${s.label}: ${f.message}`))
    if (failures.length === 0) {
      vscode.window.showInformationMessage('depwatch: gates pass.')
      return
    }
    const pick = await vscode.window.showWarningMessage(
      `depwatch: ${failures.length} gate(s) failing — ${failures[0]}`,
      'Show report',
    )
    if (pick) panel.show()
  })

  register('depwatch.showTrend', async () => {
    const path = await activeManifest()
    if (!path) return
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(path))
    if (!folder) {
      vscode.window.showWarningMessage('depwatch: trend needs the manifest to sit inside a workspace folder.')
      return
    }
    // git wants a repo-relative path, with forward slashes on every platform.
    const rel = relative(folder.uri.fsPath, path).split(/[\\/]/).join('/')
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `depwatch: reading history of ${rel}` },
      () => showHistory(rel, folder.uri.fsPath, cfg()),
    )
  })

  // --- exporting ---

  register('depwatch.exportReport', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    const uri = await vscode.window.showSaveDialog({
      filters: { HTML: ['html'] },
      saveLabel: 'Export report',
      defaultUri: defaultExportUri('depwatch-report.html'),
    })
    if (!uri) return
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(panel.export()))
    const pick = await vscode.window.showInformationMessage(`depwatch: wrote ${basename(uri.fsPath)}`, 'Open')
    if (pick) await vscode.env.openExternal(uri)
  })

  register('depwatch.exportChart', async () => {
    const path = await activeManifest()
    if (!path) return
    let scan = results.get(path)
    if (!scan) {
      try {
        scan = await scanner().scan(path, { deep: cfg().deep })
        results.set(scan)
      } catch (e: unknown) {
        vscode.window.showWarningMessage(`depwatch: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    const uri = await vscode.window.showSaveDialog({
      filters: { SVG: ['svg'] },
      saveLabel: 'Export chart',
      defaultUri: defaultExportUri('depwatch-quadrant.svg'),
    })
    if (!uri) return
    const svg = quadrantSVG(scan.report.deps, {
      title: `${scan.report.file} — drift × viability (${scan.report.totalLibyears.toFixed(2)} libyears)`,
      thresholds: cfg().thresholds,
    })
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(svg))
  })

  // --- the baseline ---

  // Writing a baseline does not rescan: the reports are already in hand, and
  // accepting them is a filter over what they say.
  register('depwatch.writeBaseline', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    const uri = baseline.uri()
    if (!uri) {
      vscode.window.showWarningMessage('depwatch: a baseline needs an open workspace folder.')
      return
    }
    // The scans in `results` may already be filtered by an older baseline, so
    // the new one is written from a full rescan of what is cached — otherwise
    // accepting twice would quietly forget the first set.
    const full = await Promise.all(results.all().map((s) => scanner().scan(s.path, { deep: s.deep })))
    await baseline.write(uri, full)
    for (const scan of full) results.set(baseline.apply(scan))

    const pick = await vscode.window.showInformationMessage(
      `depwatch: accepted ${acceptableCount(full)} finding(s) into ${basename(uri.fsPath)}. Only what gets worse will show from now on.`,
      'Open baseline',
    )
    if (pick) await vscode.window.showTextDocument(uri)
  })

  register('depwatch.clearBaseline', async () => {
    const uri = baseline.uri()
    if (!uri) return
    try {
      await vscode.workspace.fs.delete(uri)
    } catch {
      vscode.window.showInformationMessage('depwatch: there was no baseline to clear.')
      return
    }
    baseline.forget()
    await scanAll({ quiet: true })
    vscode.window.showInformationMessage('depwatch: baseline cleared. Every finding is shown again.')
  })

  // --- the token ---

  register('depwatch.setGitHubToken', async () => {
    const token = await vscode.window.showInputBox({
      title: 'GitHub token for depwatch deep scans',
      prompt: 'Public-repo read access is enough. Stored in the OS keychain, never in settings.',
      password: true,
      ignoreFocusOut: true,
    })
    if (token === undefined) return
    if (token === '') {
      await deps.secrets.delete('depwatch.githubToken')
      delete process.env.GITHUB_TOKEN
      vscode.window.showInformationMessage('depwatch: GitHub token cleared.')
      return
    }
    await deps.secrets.store('depwatch.githubToken', token)
    process.env.GITHUB_TOKEN = token
    vscode.window.showInformationMessage('depwatch: GitHub token stored. Deep scans will use it.')
  })
}

/**
 * The trend, or the one failure the editor can actually fix. A missing binary
 * is offered as a command rather than only named — and it runs in a terminal
 * and not through exec, because `sudo` needs somewhere to ask for a password
 * and a package manager mid-install is something you want to watch.
 */
async function showHistory(rel: string, cwd: string, cfg: Config): Promise<void> {
  try {
    const points = await trend(rel, undefined, {
      cwd,
      maxPoints: cfg.trendMaxPoints,
      thresholds: cfg.thresholds,
    })
    showTrend(rel, points)
  } catch (e: unknown) {
    const message = `depwatch: ${e instanceof Error ? e.message : String(e)}`
    if (!isMissingGit(e)) {
      vscode.window.showWarningMessage(message)
      return
    }
    const pick = await vscode.window.showWarningMessage(message, `Run \`${INSTALL_GIT}\``)
    if (!pick) return
    const terminal = vscode.window.createTerminal('depwatch: install git')
    terminal.show()
    terminal.sendText(INSTALL_GIT)
  }
}

function defaultExportUri(name: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder ? vscode.Uri.joinPath(folder.uri, name) : undefined
}
