// Activation and wiring.
//
// The scan policy lives here, and it is deliberately dull: on startup, on save,
// on a slow timer, or when asked. Never on a keystroke. Everything expensive is
// behind the caches in cache.ts, and everything that could pile up is behind
// the debouncer in schedule.ts.
//
// What each command does is in commands.ts, and the baseline file is in
// baseline-file.ts; this file only builds the pieces and connects them.

import * as vscode from 'vscode'
import { dirname } from 'node:path'
import { basename, LOCK_FOR } from '../../../src/manifest.js'
import { ScanAborted } from '../../../src/report.js'
import { Annotator } from './annotate.js'
import { WorkspaceBaseline } from './baseline-file.js'
import { registerCommands } from './commands.js'
import { affectsResults, type Config, readConfig } from './config.js'
import { findManifests, isExcluded, isScannable, type Scan, Scanner } from './engine.js'
import { ReportPanel } from './panel.js'
import { Debouncer, Heartbeat } from './schedule.js'
import { Results } from './state.js'
import { StatusBar } from './status.js'
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
  const baseline = new WorkspaceBaseline(cfg)
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

  async function loadBaseline(): Promise<void> {
    const line = await baseline.load()
    if (line) log.debug(line)
  }

  // A token typed once, kept in the OS keychain rather than in settings.json
  // where a repo's secret scanner would eventually find it.
  const stored = await context.secrets.get('depwatch.githubToken')
  if (stored && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = stored

  // --- scanning ---

  // One controller per scan run; the cancel command and the progress
  // notification's own button both abort it.
  let running: AbortController | null = null
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
          results.set(baseline.apply(partial))
          opts.report?.(`${partial.label} — ${done}/${total}`)
        },
      })
      results.set(baseline.apply(scan))
      log.debug(`${scan.label}: ${scan.report.totalLibyears.toFixed(2)} libyears, ${scan.report.deps.length} deps`)
    } catch (e: unknown) {
      scanFailed(path, e)
    } finally {
      scanning--
      if (scanning === 0) status.scanning(false)
    }
  }

  function scanFailed(path: string, e: unknown): void {
    const label = vscode.workspace.asRelativePath(path)
    // Cancelling is a choice, not a failure: leave what was found in place.
    if (e instanceof ScanAborted) {
      log.debug(`${label}: cancelled`)
      return
    }
    const message = e instanceof Error ? e.message : String(e)
    log.debug(`${label}: ${message}`)
    // A manifest with no dependencies is a normal thing to have — a tooling
    // package.json, an empty requirements.txt — and listing every one of them
    // as a problem would bury the manifests that genuinely could not be read.
    if (/no dependencies found/.test(message)) results.remove(path)
    else results.fail({ path, label, message })
  }

  async function scanAll(opts: { deep?: boolean; force?: boolean; quiet?: boolean } = {}): Promise<void> {
    if (!cfg.enable) return
    const manifests = await findManifests(cfg)
    log.debug(`${manifests.length} manifest(s); excluding ${cfg.excludeGlobs.length} glob(s)`)
    if (manifests.length === 0) {
      if (!opts.quiet) vscode.window.showInformationMessage('depwatch: no dependency manifests found in this workspace.')
      return
    }
    running?.abort()
    const controller = new AbortController()
    running = controller
    // Background scans report into the pane's own progress bar; a scan you asked
    // for gets a notification, because it is the one you are waiting on.
    const options: vscode.ProgressOptions = opts.quiet
      ? { location: { viewId: 'depwatch.findings' } }
      : { location: vscode.ProgressLocation.Notification, title: 'depwatch', cancellable: true }
    try {
      await vscode.window.withProgress(options, async (progress, token) => {
        token.onCancellationRequested(() => controller.abort())
        // One manifest at a time: each already runs its own registry requests in
        // parallel, and multiplying the two is how an editor extension ends up
        // saturating someone's connection.
        for (const [i, path] of manifests.entries()) {
          if (controller.signal.aborted) break
          progress.report({ message: `${vscode.workspace.asRelativePath(path)} (${i + 1}/${manifests.length})` })
          await scanOne(path, { ...opts, report: (message) => progress.report({ message }) })
        }
      })
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

  /** The manifests a changed file makes stale, rescanned after the debounce. */
  function touched(path: string): void {
    if (!cfg.enable || !cfg.onSave || isExcluded(path, cfg)) return
    for (const target of staleFor(path, cfg, results.all())) {
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
      // Without this the scanner keeps the deleted manifest's parse — deps,
      // notes and the whole previous report — for the life of the window.
      scanner.forget(uri.fsPath)
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
      for (const part of [tree, annotator, status, panel, baseline]) part.setConfig(cfg)

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

  registerCommands(context, {
    log,
    results,
    tree,
    panel,
    baseline,
    secrets: context.secrets,
    cfg: () => cfg,
    scanner: () => scanner,
    scanOne,
    scanAll,
    cancel: () => {
      if (!running) return false
      running.abort()
      log.debug('cancelled by request')
      return true
    },
  })

  // --- first run ---

  await loadBaseline()
  const baselineWatcher = vscode.workspace.createFileSystemWatcher(`**/${cfg.baselinePath}`)
  const rereadBaseline = async () => {
    await loadBaseline()
    // Re-filter what is already scanned; no registry is involved.
    for (const scan of results.all()) results.set(baseline.apply(await scanner.scan(scan.path, { deep: scan.deep })))
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
}

export function deactivate(): void {
  // Everything is in context.subscriptions.
}

/**
 * The manifests a changed file makes stale. A lock file changing (npm install,
 * cargo update) changes the versions of every manifest beside it, so those are
 * what get rescanned rather than the lock itself, which is never scanned alone.
 */
function staleFor(path: string, cfg: Config, scans: Scan[]): string[] {
  if (LOCK_NAMES.includes(basename(path))) {
    return scans.filter((s) => dirname(s.path) === dirname(path)).map((s) => s.path)
  }
  return isScannable(path, cfg) ? [path] : []
}

function manifestNames(cfg: Config): string[] {
  return cfg.manifests.map((glob) => glob.split('/').pop() ?? glob)
}
