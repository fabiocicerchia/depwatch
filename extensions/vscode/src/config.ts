// Settings, read once per scan and passed around as a plain object.

import * as vscode from 'vscode'
import type { Gates } from '../../../src/gates.js'
import type { Quadrant, Thresholds } from '../../../src/report.js'
import { directoryNames } from './exclude.js'
import type { BadgeMode } from './totals.js'

export interface Severities {
  replace: vscode.DiagnosticSeverity | null
  upgrade: vscode.DiagnosticSeverity | null
  watch: vscode.DiagnosticSeverity | null
  healthy: vscode.DiagnosticSeverity | null
  degraded: vscode.DiagnosticSeverity | null
}

export interface Config {
  enable: boolean
  manifests: string[]
  /** depwatch's own excludes, plus the editor's when useEditorExcludes is on. */
  excludeGlobs: string[]
  /** The directory names within those, for checking file events cheaply. */
  excludedDirs: Set<string>
  maxManifests: number
  deep: boolean
  transitive: boolean
  useLockFile: boolean
  concurrency: number
  thresholds: Thresholds
  gates: Gates
  gatesConfigured: boolean
  onStartup: boolean
  onSave: boolean
  debounceMs: number
  refreshMs: number
  registryTtlMs: number
  deepTtlMs: number
  maxEntries: number
  maxInMemory: number
  diagnostics: boolean
  severities: Severities
  statusBar: boolean
  badge: BadgeMode
  trendMaxPoints: number
}

const HOUR = 3_600_000

export function readConfig(scope?: vscode.Uri): Config {
  const c = vscode.workspace.getConfiguration('depwatch', scope)
  const maxLibyears = c.get<number | null>('gates.maxLibyears', null)
  const maxReplace = c.get<number | null>('gates.maxReplace', null)

  return {
    enable: c.get('enable', true),
    manifests: c.get('manifests', []),
    ...excludes(c, scope),
    maxManifests: c.get('maxManifests', 25),
    deep: c.get('deep', false),
    transitive: c.get('transitive', false),
    useLockFile: c.get('useLockFile', true),
    concurrency: c.get('concurrency', 6),
    thresholds: {
      staleLibyears: c.get('thresholds.staleLibyears', 1),
      riskyViability: c.get('thresholds.riskyViability', 0.5),
    },
    gates: { maxLibyears: maxLibyears ?? undefined, maxReplace: maxReplace ?? undefined },
    gatesConfigured: maxLibyears !== null || maxReplace !== null,
    onStartup: c.get('scan.onStartup', true),
    onSave: c.get('scan.onSave', true),
    debounceMs: c.get('scan.debounceMs', 1500),
    refreshMs: c.get('scan.refreshMinutes', 360) * 60_000,
    registryTtlMs: c.get('cache.registryTtlHours', 12) * HOUR,
    deepTtlMs: c.get('cache.deepTtlHours', 72) * HOUR,
    maxEntries: c.get('cache.maxEntries', 5000),
    maxInMemory: c.get('cache.maxInMemory', 200),
    diagnostics: c.get('diagnostics.enable', true),
    severities: {
      replace: severity(c.get('diagnostics.replace', 'warning')),
      upgrade: severity(c.get('diagnostics.upgrade', 'info')),
      watch: severity(c.get('diagnostics.watch', 'info')),
      healthy: severity(c.get('diagnostics.healthy', 'off')),
      degraded: severity(c.get('diagnostics.degraded', 'off')),
    },
    statusBar: c.get('statusBar', true),
    badge: c.get<BadgeMode>('badge', 'toAddress'),
    trendMaxPoints: c.get('trend.maxPoints', 12),
  }
}

// files.exclude and search.exclude are the editor's own answer to "what is not
// part of this project". Merging them is the difference between honouring that
// and quietly overriding it.
function excludes(c: vscode.WorkspaceConfiguration, scope?: vscode.Uri): Pick<Config, 'excludeGlobs' | 'excludedDirs'> {
  // Defensive about the shape: this setting was a single glob string before it
  // was a list, and someone's settings.json may still say so.
  const own = c.get<string[] | string>('exclude', [])
  const globs = [...(typeof own === 'string' ? [own] : own)]

  if (c.get('useEditorExcludes', true)) {
    const editor = vscode.workspace.getConfiguration(undefined, scope)
    for (const section of ['files.exclude', 'search.exclude']) {
      const entries = editor.get<Record<string, unknown>>(section) ?? {}
      // A value may be `true` or a `{ when: ... }` condition; both mean hidden.
      for (const [glob, on] of Object.entries(entries)) if (on) globs.push(glob)
    }
  }

  return { excludeGlobs: globs, excludedDirs: directoryNames(globs) }
}

export function severityFor(cfg: Config, quadrant: Quadrant, degraded: boolean): vscode.DiagnosticSeverity | null {
  return degraded ? cfg.severities.degraded : cfg.severities[quadrant]
}

function severity(name: string): vscode.DiagnosticSeverity | null {
  switch (name) {
    case 'error':
      return vscode.DiagnosticSeverity.Error
    case 'warning':
      return vscode.DiagnosticSeverity.Warning
    case 'info':
      return vscode.DiagnosticSeverity.Information
    case 'hint':
      return vscode.DiagnosticSeverity.Hint
    default:
      return null
  }
}

/** Which settings, when changed, mean the current results are no longer valid. */
export function affectsResults(e: vscode.ConfigurationChangeEvent): boolean {
  return [
    'depwatch.deep',
    'depwatch.transitive',
    'depwatch.useLockFile',
    'depwatch.thresholds',
    'depwatch.manifests',
    'depwatch.exclude',
    'depwatch.useEditorExcludes',
    'depwatch.maxManifests',
    // Not ours, but they decide what gets scanned all the same.
    'files.exclude',
    'search.exclude',
  ].some((key) => e.affectsConfiguration(key))
}
