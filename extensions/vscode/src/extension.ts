// Activation and wiring.
//
// The scan policy lives here, and it is deliberately dull: on startup, on save,
// on a slow timer, or when asked. Never on a keystroke. Everything expensive is
// behind the caches in cache.ts, and everything that could pile up is behind
// the debouncer in schedule.ts.

import * as vscode from 'vscode'
import { dirname, relative } from 'node:path'
import { basename, LOCK_FOR } from '../../../src/manifest.js'
import { quadrantSVG } from '../../../src/quadrant.js'
import { ScanAborted } from '../../../src/report.js'
import { gateFailures } from '../../../src/gates.js'
import { trend } from '../../../src/trend.js'
import { Annotator } from './annotate.js'
import { acceptedIn, type Baseline, parse as parseBaseline, serialise, withoutAccepted } from './baseline.js'
import { affectsResults, type Config, readConfig } from './config.js'
import { findManifests, isExcluded, isScannable, type Scan, Scanner } from './engine.js'
import { locateDeps } from './locate.js'
import { ReportPanel, showTrend } from './panel.js'
import { Debouncer, Heartbeat } from './schedule.js'
import { Results } from './state.js'
import { StatusBar } from './status.js'
import { LENS_BLURB, LENS_LABEL, LENSES } from './totals.js'
import { type Node as FindingNode, FindingsTree } from './tree.js'

const LOCK_NAMES = [...new Set(Object.values(LOCK_FOR).flat())]

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('depwatch', { log: true })
  let cfg = readConfig()

  const results = new Results()
  let scanner = new Scanner(context.globalStorageUri, cfg)
  const tree = new FindingsTree(results, cfg)
  const annotator = new Annotator(results, cfg)
  const status = new StatusBar(results, cfg)
  const panel = new ReportPanel(results, cfg)
  let debouncer = new Debouncer(cfg.debounceMs)

  const view = vscode.window.createTreeView<FindingNode>('depwatch.findings', {
    treeDataProvider: tree,
    showCollapseAll: true,
  })
  tree.attach(view)
  tree.setScope('file')
  tree.setFilter(null)

  context.subscriptions.push(log, results, tree, annotator, status, panel, view, {
    dispose: () => debouncer.dispose(),
  })

  // A baseline is a file in the workspace, so it can be committed and shared:
  // "we accept this much drift today" is a team decision, not a per-machine one.
  let baseline: Baseline | null = null

  async function baselineUri(): Promise<vscode.Uri | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0]
    return folder && vscode.Uri.joinPath(folder.uri, cfg.baselinePath)
  }

  async function loadBaseline(): Promise<void> {
    const uri = await baselineUri()
    if (!uri) return
    try {
      baseline = parseBaseline(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)))
      log.debug(baseline ? `baseline: ${Object.keys(baseline.manifests).length} manifest(s)` : 'baseline: unreadable')
    } catch {
      baseline = null // no file is the normal case, not an error
    }
  }

  // Applied here rather than in the scanner, so writing a baseline re-filters
  // what is already in hand instead of costing a rescan.
  function accept(scan: Scan): Scan {
    const accepted = acceptedIn(baseline, scan.label, scan.report)
    if (accepted.size === 0) return scan
    return { ...scan, report: withoutAccepted(scan.report, accepted), accepted: accepted.size }
  }

  // One controller per scan run; the cancel command and the progress
  // notification's own button both abort it.
  let running: AbortController | null = null

  // A token typed once, kept in the OS keychain rather than in settings.json
  // where a repo's secret scanner would eventually find it.
  const stored = await context.secrets.get('depwatch.githubToken')
  if (stored && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = stored

  // --- scanning ---

  let scanning = 0

  async function scanOne(
    path: string,
    opts: { deep?: boolean; force?: boolean; report?: (message: string) => void } = {},
  ): Promise<void> {
    scanning++
    status.scanning(true)
    try {
      const scan = await scanner.scan(path, {
        deep: opts.deep ?? false,
        force: opts.force,
        signal: running?.signal,
        // Findings appear as the registries answer, rather than the pane sitting
        // empty until the slowest one does.
        onPartial: (partial, done, total) => {
          results.set(accept(partial))
          opts.report?.(`${partial.label} — ${done}/${total}`)
        },
      })
      results.set(accept(scan))
      log.debug(`${scan.label}: ${scan.report.totalLibyears.toFixed(2)} libyears, ${scan.report.deps.length} deps`)
    } catch (e: unknown) {
      // Cancelling is a choice, not a failure: leave what was found in place.
      if (e instanceof ScanAborted) {
        log.debug(`${vscode.workspace.asRelativePath(path)}: cancelled`)
        return
      }
      const message = e instanceof Error ? e.message : String(e)
      const label = vscode.workspace.asRelativePath(path)
      log.debug(`${label}: ${message}`)
      // A manifest with no dependencies is a normal thing to have — a tooling
      // package.json, an empty requirements.txt — and listing every one of them
      // as a problem would bury the manifests that genuinely could not be read.
      if (/no dependencies found/.test(message)) results.remove(path)
      else results.fail({ path, label, message })
    } finally {
      scanning--
      if (scanning === 0) status.scanning(false)
    }
  }

  async function scanAll(opts: { deep?: boolean; force?: boolean; quiet?: boolean } = {}): Promise<void> {
    if (!cfg.enable) return
    const manifests = await findManifests(cfg)
    log.debug(`${manifests.length} manifest(s); excluding ${cfg.excludeGlobs.length} glob(s)`)
    if (manifests.length === 0) {
      if (!opts.quiet) vscode.window.showInformationMessage('depwatch: no dependency manifests found in this workspace.')
      return
    }
    // One manifest at a time: each already runs its own registry requests in
    // parallel, and multiplying the two is how an editor extension ends up
    // saturating someone's connection.
    running?.abort()
    const controller = new AbortController()
    running = controller
    // Background scans report into the pane's own progress bar; a scan you asked
    // for gets a notification, because it is the one you are waiting on.
    const options: vscode.ProgressOptions = opts.quiet
      ? { location: { viewId: 'depwatch.findings' } }
      : { location: vscode.ProgressLocation.Notification, title: 'depwatch', cancellable: true }
    try {
      await vscode.window.withProgress(
        options,
        async (progress, token) => {
          token.onCancellationRequested(() => controller.abort())
          for (const [i, path] of manifests.entries()) {
            if (controller.signal.aborted) break
            progress.report({ message: `${vscode.workspace.asRelativePath(path)} (${i + 1}/${manifests.length})` })
            await scanOne(path, { ...opts, report: (message) => progress.report({ message }) })
          }
        },
      )
    } finally {
      if (running === controller) running = null
    }
  }

  const heartbeat = new Heartbeat({
    intervalMs: cfg.refreshMs,
    isFocused: () => vscode.window.state.focused,
    run: () => {
      log.debug('periodic refresh')
      void scanAll({ force: true, quiet: true })
    },
  })
  heartbeat.start()
  context.subscriptions.push(
    heartbeat,
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) heartbeat.resumed()
    }),
  )

  // --- triggers ---

  function touched(path: string): void {
    if (!cfg.enable || !cfg.onSave || isExcluded(path, cfg)) return
    const base = basename(path)
    // A lock file changing (npm install, cargo update) changes the versions of
    // every manifest beside it, so those are what get rescanned.
    const targets = LOCK_NAMES.includes(base)
      ? results.all().filter((s) => dirname(s.path) === dirname(path)).map((s) => s.path)
      : isScannable(path, cfg)
        ? [path]
        : []
    for (const target of targets) {
      scanner.forget(target)
      debouncer.schedule(target, () => void scanOne(target))
    }
  }

  const watched = [...new Set([...manifestNames(cfg), ...LOCK_NAMES])].join(',')
  const watcher = vscode.workspace.createFileSystemWatcher(`**/{${watched}}`)
  context.subscriptions.push(
    watcher,
    // Saves inside the editor and changes made by a package manager both land
    // here; the debouncer makes the overlap free.
    watcher.onDidChange((uri) => touched(uri.fsPath)),
    watcher.onDidCreate((uri) => touched(uri.fsPath)),
    watcher.onDidDelete((uri) => {
      results.remove(uri.fsPath)
      annotator.forget(uri.fsPath)
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file') touched(doc.uri.fsPath)
    }),
  )

  // --- settings ---

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // The editor's own excludes are not ours, but they decide what is scanned.
      const editorExcludes = e.affectsConfiguration('files.exclude') || e.affectsConfiguration('search.exclude')
      if (!e.affectsConfiguration('depwatch') && !editorExcludes) return
      const previous = cfg
      cfg = readConfig()
      tree.setConfig(cfg)
      annotator.setConfig(cfg)
      status.setConfig(cfg)
      panel.setConfig(cfg)

      if (previous.debounceMs !== cfg.debounceMs) {
        debouncer.dispose()
        debouncer = new Debouncer(cfg.debounceMs)
      }
      heartbeat.setIntervalMs(cfg.refreshMs)
      // The scanner bakes in its TTLs, concurrency and thresholds, so it is
      // rebuilt rather than mutated. Only the in-memory layer is lost — the
      // disk cache is what makes the next scan fast, and that stays.
      void scanner.flush()
      scanner = new Scanner(context.globalStorageUri, cfg)
      if (affectsResults(e)) void scanAll({ quiet: true })
    }),
  )

  // --- commands ---

  const register = (name: string, run: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, run))

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

  register('depwatch.showReport', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    panel.show()
  })

  register('depwatch.setScopeFile', () => tree.setScope('file'))
  register('depwatch.setScopeProject', () => tree.setScope('project'))
  register('depwatch.expandAll', () => tree.expandAll())
  register('depwatch.showLog', () => log.show())

  register('depwatch.cancel', () => {
    if (!running) {
      vscode.window.showInformationMessage('depwatch: no scan is running.')
      return
    }
    running.abort()
    log.debug('cancelled by request')
  })

  // Writing a baseline does not rescan: the reports are already in hand, and
  // accepting them is a filter over what they say.
  register('depwatch.writeBaseline', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    const uri = await baselineUri()
    if (!uri) {
      vscode.window.showWarningMessage('depwatch: a baseline needs an open workspace folder.')
      return
    }
    // The scans in `results` may already be filtered by an older baseline, so
    // the new one is written from a full rescan of what is cached — otherwise
    // accepting twice would quietly forget the first set.
    const full = await Promise.all(results.all().map((s) => scanner.scan(s.path, { deep: s.deep })))
    const text = serialise(full, new Date().toISOString())
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text))
    await loadBaseline()
    for (const scan of full) results.set(accept(scan))

    const accepted = full.reduce((n, s) => n + s.report.deps.filter((d) => d.quadrant !== 'healthy' && !d.degraded).length, 0)
    const pick = await vscode.window.showInformationMessage(
      `depwatch: accepted ${accepted} finding(s) into ${basename(uri.fsPath)}. Only what gets worse will show from now on.`,
      'Open baseline',
    )
    if (pick) await vscode.window.showTextDocument(uri)
  })

  register('depwatch.clearBaseline', async () => {
    const uri = await baselineUri()
    if (!uri) return
    try {
      await vscode.workspace.fs.delete(uri)
    } catch {
      vscode.window.showInformationMessage('depwatch: there was no baseline to clear.')
      return
    }
    baseline = null
    await scanAll({ quiet: true })
    vscode.window.showInformationMessage('depwatch: baseline cleared. Every finding is shown again.')
  })
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

  register('depwatch.checkGates', async () => {
    if (results.size === 0) await scanAll({ quiet: true })
    if (!cfg.gatesConfigured) {
      const pick = await vscode.window.showInformationMessage(
        'depwatch: no gates configured. Set depwatch.gates.maxLibyears or depwatch.gates.maxReplace to fail on a budget, the same way depwatch check --ci does.',
        'Open settings',
      )
      if (pick) await vscode.commands.executeCommand('workbench.action.openSettings', 'depwatch.gates')
      return
    }
    const failures = results.all().flatMap((s) => gateFailures(s.report, cfg.gates).map((f) => `${s.label}: ${f.message}`))
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
      async () => {
        try {
          const points = await trend(rel, undefined, {
            cwd: folder.uri.fsPath,
            maxPoints: cfg.trendMaxPoints,
            thresholds: cfg.thresholds,
          })
          showTrend(rel, points)
        } catch (e: unknown) {
          vscode.window.showWarningMessage(`depwatch: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
    )
  })

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
        scan = await scanner.scan(path, { deep: cfg.deep })
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
      thresholds: cfg.thresholds,
    })
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(svg))
  })

  register('depwatch.clearCache', async () => {
    await scanner.clear()
    results.clear()
    vscode.window.showInformationMessage('depwatch: registry cache cleared. The next scan will refetch.')
  })

  register('depwatch.setGitHubToken', async () => {
    const token = await vscode.window.showInputBox({
      title: 'GitHub token for depwatch deep scans',
      prompt: 'Public-repo read access is enough. Stored in the OS keychain, never in settings.',
      password: true,
      ignoreFocusOut: true,
    })
    if (token === undefined) return
    if (token === '') {
      await context.secrets.delete('depwatch.githubToken')
      delete process.env.GITHUB_TOKEN
      vscode.window.showInformationMessage('depwatch: GitHub token cleared.')
      return
    }
    await context.secrets.store('depwatch.githubToken', token)
    process.env.GITHUB_TOKEN = token
    vscode.window.showInformationMessage('depwatch: GitHub token stored. Deep scans will use it.')
  })

  // --- first run ---

  await loadBaseline()
  const baselineWatcher = vscode.workspace.createFileSystemWatcher(`**/${cfg.baselinePath}`)
  const rereadBaseline = async () => {
    await loadBaseline()
    // Re-filter what is already scanned; no registry is involved.
    for (const scan of results.all()) results.set(accept(await scanner.scan(scan.path, { deep: scan.deep })))
  }
  context.subscriptions.push(
    baselineWatcher,
    baselineWatcher.onDidChange(() => void rereadBaseline()),
    baselineWatcher.onDidCreate(() => void rereadBaseline()),
    baselineWatcher.onDidDelete(() => void rereadBaseline()),
  )

  // Pruning is the only maintenance the cache needs, and once per session is
  // plenty. Deliberately not awaited: it must never delay the first scan.
  void scanner.prune().catch(() => undefined)

  if (cfg.enable && cfg.onStartup) void scanAll({ quiet: true })

  context.subscriptions.push({ dispose: () => void scanner.flush() })

  async function activeManifest(): Promise<string | undefined> {
    const active = vscode.window.activeTextEditor?.document
    if (active?.uri.scheme === 'file' && isScannable(active.uri.fsPath, cfg)) return active.uri.fsPath

    const candidates = results.size > 0 ? results.all().map((s) => s.path) : await findManifests(cfg)
    if (candidates.length === 0) {
      vscode.window.showWarningMessage('depwatch: no dependency manifest found.')
      return undefined
    }
    if (candidates.length === 1) return candidates[0]
    return vscode.window.showQuickPick(
      candidates.map((path) => ({ label: vscode.workspace.asRelativePath(path), path })),
      { title: 'Which manifest?' },
    ).then((pick) => pick?.path)
  }
}

export function deactivate(): void {
  // Everything is in context.subscriptions.
}

function manifestNames(cfg: Config): string[] {
  return cfg.manifests.map((glob) => glob.split('/').pop() ?? glob)
}

function defaultExportUri(name: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder ? vscode.Uri.joinPath(folder.uri, name) : undefined
}
