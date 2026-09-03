// Activation and wiring.
//
// The scan policy is decided here and it is deliberately dull: on startup, on
// save, on a slow timer, or when asked. Never on a keystroke. Everything
// expensive is behind the caches in cache.ts, and everything that could pile up
// is behind the debouncer in schedule.ts.
//
// One scan run is scan-runner.ts, what each command does is commands.ts, and
// the baseline file is baseline-file.ts; this builds the pieces and connects
// them.

import * as vscode from 'vscode'
import { dirname } from 'node:path'
import { basename, LOCK_FOR } from '../../../src/manifest.js'
import { Annotator } from './annotate.js'
import { WorkspaceBaseline } from './baseline-file.js'
import { registerCommands } from './commands.js'
import { affectsResults, type Config, readConfig } from './config.js'
import { isExcluded, isScannable, type Scan, Scanner } from './engine.js'
import { ReportPanel } from './panel.js'
import { Debouncer, Heartbeat } from './schedule.js'
import { ScanRunner, type ScanOptions } from './scan-runner.js'
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
  const baseline = new WorkspaceBaseline(cfg, log)
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

  // A token typed once, kept in the OS keychain rather than in settings.json
  // where a repo's secret scanner would eventually find it.
  const stored = await context.secrets.get('depwatch.githubToken')
  if (stored && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = stored

  // --- scanning ---

  const runner = new ScanRunner({
    log,
    results,
    status,
    baseline,
    cfg: () => cfg,
    scanner: () => scanner,
  })
  const scanAll = (opts?: ScanOptions) => runner.all(opts)

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
      debouncer.schedule(target, () => void runner.one(target))
    }
  }

  const watched = [...new Set([...manifestNames(cfg), ...LOCK_NAMES])].join(',')
  watchManifests(context, `**/{${watched}}`, {
    touched,
    deleted: (path) => {
      results.remove(path)
      annotator.forget(path)
      // Without this the scanner keeps the deleted manifest's parse — deps,
      // notes and the whole previous report — for the life of the window.
      scanner.forget(path)
    },
  })

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
    scanOne: (path, opts) => runner.one(path, opts),
    scanAll,
    cancel: () => runner.cancel(),
  })

  // --- first run ---

  await baseline.load()
  watchBaseline(context, `**/${cfg.baselinePath}`, async () => {
    await baseline.load()
    // Re-filter what is already scanned; no registry is involved.
    for (const scan of results.all()) results.set(baseline.apply(await scanner.scan(scan.path, { deep: scan.deep })))
  })

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

/**
 * Saves inside the editor and changes made by a package manager both land here;
 * the debouncer makes the overlap free.
 */
function watchManifests(
  context: vscode.ExtensionContext,
  glob: string,
  on: { touched: (path: string) => void; deleted: (path: string) => void },
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(glob)
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => on.touched(uri.fsPath)),
    watcher.onDidCreate((uri) => on.touched(uri.fsPath)),
    watcher.onDidDelete((uri) => on.deleted(uri.fsPath)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file') on.touched(doc.uri.fsPath)
    }),
  )
}

/** The baseline is a committed file: a `git pull` changes it as surely as an
 * edit does, and either way what is on screen has to follow. */
function watchBaseline(context: vscode.ExtensionContext, glob: string, reread: () => void): void {
  const watcher = vscode.workspace.createFileSystemWatcher(glob)
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(reread),
    watcher.onDidCreate(reread),
    watcher.onDidDelete(reread),
  )
}

function manifestNames(cfg: Config): string[] {
  return cfg.manifests.map((glob) => glob.split('/').pop() ?? glob)
}
