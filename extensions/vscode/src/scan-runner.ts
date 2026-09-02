// When a scan runs, and what happens while it does.
//
// The policy itself is dull on purpose — on startup, on save, on a slow timer,
// or when asked, never on a keystroke — and lives with its triggers in
// extension.ts. What is here is one run: the progress it reports, the one
// controller that cancels it, and what each of the ways it can fail means.
//
// The scanner and the configuration are getters because both are rebuilt when
// settings change; a run always uses the current pair.

import * as vscode from 'vscode'
import { ScanAborted } from '../../../src/report.js'
import type { WorkspaceBaseline } from './baseline-file.js'
import type { Config } from './config.js'
import { findManifests, type Scanner } from './engine.js'
import type { Results } from './state.js'
import type { StatusBar } from './status.js'

export interface RunnerDeps {
  log: vscode.LogOutputChannel
  results: Results
  status: StatusBar
  baseline: WorkspaceBaseline
  cfg: () => Config
  scanner: () => Scanner
}

export interface ScanOptions {
  deep?: boolean
  force?: boolean
  quiet?: boolean
}

export class ScanRunner {
  /** One controller per run; the cancel command and the progress notification's
   * own button both abort it. */
  private running: AbortController | null = null
  private scanning = 0

  constructor(private readonly deps: RunnerDeps) {}

  /** Scan one manifest, reporting partial findings as the registries answer. */
  async one(path: string, opts: ScanOptions & { report?: (message: string) => void } = {}): Promise<void> {
    const { results, status, baseline, log } = this.deps
    this.scanning++
    status.scanning(true)
    try {
      const scan = await this.deps.scanner().scan(path, {
        deep: opts.deep ?? false,
        force: opts.force,
        signal: this.running?.signal,
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
      this.failed(path, e)
    } finally {
      this.scanning--
      if (this.scanning === 0) status.scanning(false)
    }
  }

  /** Scan every manifest in the workspace, one at a time. */
  async all(opts: ScanOptions = {}): Promise<void> {
    const { log, cfg } = this.deps
    if (!cfg().enable) return
    const manifests = await findManifests(cfg())
    log.debug(`${manifests.length} manifest(s); excluding ${cfg().excludeGlobs.length} glob(s)`)
    if (manifests.length === 0) {
      if (!opts.quiet) vscode.window.showInformationMessage('depwatch: no dependency manifests found in this workspace.')
      return
    }

    this.running?.abort()
    const controller = new AbortController()
    this.running = controller
    try {
      await vscode.window.withProgress(progressFor(opts), async (progress, token) => {
        token.onCancellationRequested(() => controller.abort())
        // One manifest at a time: each already runs its own registry requests in
        // parallel, and multiplying the two is how an editor extension ends up
        // saturating someone's connection.
        for (const [i, path] of manifests.entries()) {
          if (controller.signal.aborted) break
          progress.report({ message: `${vscode.workspace.asRelativePath(path)} (${i + 1}/${manifests.length})` })
          await this.one(path, { ...opts, report: (message) => progress.report({ message }) })
        }
      })
    } finally {
      if (this.running === controller) this.running = null
    }
  }

  /** Abort the running scan. False when there was none to abort. */
  cancel(): boolean {
    if (!this.running) return false
    this.running.abort()
    this.deps.log.debug('cancelled by request')
    return true
  }

  private failed(path: string, e: unknown): void {
    const { log, results } = this.deps
    const label = vscode.workspace.asRelativePath(path)
    // Cancelling is a choice, not a failure: leave what was found in place.
    if (e instanceof ScanAborted) {
      log.debug(`${label}: cancelled`)
      return
    }
    const message = e instanceof Error ? e.message : String(e)
    log.debug(`${label}: ${message}`)
    // A manifest with no dependencies is a normal thing to have — a tooling
    // package.json, an empty requirements.txt — and listing every one of them as
    // a problem would bury the manifests that genuinely could not be read.
    if (/no dependencies found/.test(message)) results.remove(path)
    else results.fail({ path, label, message })
  }
}

/**
 * Background scans report into the pane's own progress bar; a scan you asked
 * for gets a notification, because it is the one you are waiting on.
 */
function progressFor(opts: ScanOptions): vscode.ProgressOptions {
  return opts.quiet
    ? { location: { viewId: 'depwatch.findings' } }
    : { location: vscode.ProgressLocation.Notification, title: 'depwatch', cancellable: true }
}
