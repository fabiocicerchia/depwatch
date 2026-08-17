// Settings, read once per scan and passed around as a plain object.

import * as vscode from 'vscode'
import type { Gates } from '../../../src/gates.js'
import type { Quadrant, Thresholds } from '../../../src/report.js'
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
  exclude: string
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
    exclude: c.get('exclude', ''),
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
    'depwatch.maxManifests',
  ].some((key) => e.affectsConfiguration(key))
}
