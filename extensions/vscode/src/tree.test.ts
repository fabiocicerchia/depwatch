// The findings pane's shape: which groups exist, in which order, holding which
// dependencies.
//
// Everything is read back through getChildren/getTreeItem — the two methods VS
// Code itself calls — so the assertions are on what the pane renders, not on
// anything the provider stored.

import { beforeEach, describe, expect, it } from 'vitest'
import type { DepReport, Report } from '../../../src/report.js'
import { NO_SIGNALS } from '../../../src/viability.js'
import { type Config, readConfig } from './config.js'
import type { Scan } from './engine.js'
import { Results } from './state.js'
import { harness } from './testing/vscode.js'
import { FindingsTree, type Node } from './tree.js'

const dep = (over: Partial<DepReport> = {}): DepReport => ({
  name: 'left-pad',
  current: '1.0.0',
  latest: '2.0.0',
  libyearsBehind: 2.5,
  resolved: true,
  currentReleased: '2021-01-01T00:00:00Z',
  latestReleased: '2023-07-01T00:00:00Z',
  pulseYears: 2.5,
  viability: 0.3,
  quadrant: 'replace',
  signals: { ...NO_SIGNALS },
  ...over,
})

const scanOf = (path: string, deps: DepReport[]): Scan => {
  const report: Report = {
    file: path,
    ecosystem: 'npm',
    generatedAt: '2026-01-01T00:00:00.000Z',
    totalLibyears: deps.reduce((sum, d) => sum + d.libyearsBehind, 0),
    deps,
    worst: [],
  }
  return { path, label: path.replace('/repo/', ''), report, notes: [], deep: false, scannedAt: 0, signature: 's' }
}

let cfg: Config
let results: Results

/** The pane, over these scans, in project scope. */
function paneOver(scans: Scan[]): FindingsTree {
  for (const scan of scans) results.set(scan)
  const tree = new FindingsTree(results, cfg)
  tree.setScope('project')
  tree.setFilter(null)
  return tree
}

const groupLabels = (tree: FindingsTree): string[] =>
  tree
    .getChildren()
    .filter((n): n is Extract<Node, { kind: 'group' }> => n.kind === 'group')
    .map((n) => n.lens)

const depNames = (tree: FindingsTree, group: Node): string[] =>
  tree.getChildren(group).map((n) => (n.kind === 'dep' ? n.dep.name : '?'))

beforeEach(() => {
  harness.reset()
  cfg = readConfig()
  results = new Results()
})

describe('the groups of one manifest', () => {
  it('runs worst quadrant first and leaves out the empty ones', () => {
    const tree = paneOver([
      scanOf('/repo/package.json', [
        dep({ name: 'healthy-one', quadrant: 'healthy', libyearsBehind: 0 }),
        dep({ name: 'watch-one', quadrant: 'watch', libyearsBehind: 0.1 }),
        dep({ name: 'replace-one', quadrant: 'replace' }),
      ]),
    ])
    // No `upgrade` group: nothing is in it, and an empty heading is noise.
    expect(groupLabels(tree)).toEqual(['replace', 'watch', 'healthy'])
  })

  it('orders a group by drift, then viability, then name', () => {
    const tree = paneOver([
      scanOf('/repo/package.json', [
        dep({ name: 'b', libyearsBehind: 1 }),
        dep({ name: 'a', libyearsBehind: 1 }),
        dep({ name: 'worst', libyearsBehind: 9 }),
        dep({ name: 'tied-low-viability', libyearsBehind: 1, viability: 0.1 }),
      ]),
    ])
    const group = tree.getChildren()[0]
    expect(depNames(tree, group)).toEqual(['worst', 'tied-low-viability', 'a', 'b'])
  })

  it('keeps the unscored ones in their own group, after the quadrants', () => {
    const tree = paneOver([
      scanOf('/repo/package.json', [
        dep({ name: 'scored' }),
        dep({ name: 'unreachable', degraded: 'timeout' }),
      ]),
    ])
    expect(groupLabels(tree)).toEqual(['replace', 'degraded'])
    // A degraded dependency has a quadrant on it, and it must not be counted
    // under that quadrant as well.
    expect(depNames(tree, tree.getChildren()[0])).toEqual(['scored'])
    expect(depNames(tree, tree.getChildren()[1])).toEqual(['unreachable'])
  })

  it('ends on the summary, whatever else is there', () => {
    const tree = paneOver([scanOf('/repo/package.json', [dep()])])
    const roots = tree.getChildren()
    expect(roots[roots.length - 1].kind).toBe('summary')
  })
})

describe('the filter', () => {
  const mixed = () =>
    scanOf('/repo/package.json', [
      dep({ name: 'r' }),
      dep({ name: 'u', quadrant: 'upgrade' }),
      dep({ name: 'd', degraded: 'timeout' }),
    ])

  it('keeps only the quadrants it names', () => {
    const tree = paneOver([mixed()])
    tree.setFilter(new Set(['upgrade']))
    expect(groupLabels(tree)).toEqual(['upgrade'])
  })

  it('can name the unscored group on its own', () => {
    const tree = paneOver([mixed()])
    tree.setFilter(new Set(['degraded']))
    expect(groupLabels(tree)).toEqual(['degraded'])
  })

  it('says so rather than looking clean when nothing matches', () => {
    const tree = paneOver([scanOf('/repo/package.json', [dep()])])
    tree.setFilter(new Set(['watch']))
    const roots = tree.getChildren()
    expect(roots[0]).toMatchObject({ kind: 'message', text: 'Nothing matches the filter' })
    expect(roots[roots.length - 1].kind).toBe('summary')
  })

  it('treats "all of them" and "none of them" as no filter at all', () => {
    const tree = paneOver([mixed()])
    tree.setFilter(new Set(['replace', 'upgrade', 'watch', 'healthy', 'degraded']))
    expect(tree.getFilter()).toBeNull()
    tree.setFilter(new Set([]))
    expect(tree.getFilter()).toBeNull()
    expect(groupLabels(tree)).toEqual(['replace', 'upgrade', 'degraded'])
  })

  it('counts the current scope for the picker, unscored included', () => {
    const tree = paneOver([mixed()])
    expect(tree.scopeCounts()).toMatchObject({ replace: 1, upgrade: 1, watch: 0, healthy: 0, degraded: 1 })
  })
})

describe('more than one manifest', () => {
  it('puts a file above each set of groups', () => {
    const tree = paneOver([
      scanOf('/repo/package.json', [dep({ name: 'a' })]),
      scanOf('/repo/web/package.json', [dep({ name: 'b' })]),
    ])
    const roots = tree.getChildren()
    expect(roots.filter((n) => n.kind === 'file').map((n) => (n.kind === 'file' ? n.scan.label : ''))).toEqual([
      'package.json',
      'web/package.json',
    ])
  })

  it('drops a file whose findings the filter removed entirely', () => {
    const tree = paneOver([
      scanOf('/repo/package.json', [dep({ name: 'a' })]),
      scanOf('/repo/web/package.json', [dep({ name: 'b', quadrant: 'upgrade' })]),
    ])
    tree.setFilter(new Set(['upgrade']))
    expect(tree.getChildren().filter((n) => n.kind === 'file')).toHaveLength(1)
  })
})

describe('what a row looks like', () => {
  it('opens the replace quadrant and collapses a long upgrade one', () => {
    const many = Array.from({ length: 11 }, (_, i) => dep({ name: `u${i}`, quadrant: 'upgrade' }))
    const tree = paneOver([scanOf('/repo/package.json', [dep(), ...many])])
    const [replace, upgrade] = tree.getChildren()
    expect(tree.getTreeItem(replace).collapsibleState).toBe(2) // Expanded
    expect(tree.getTreeItem(upgrade).collapsibleState).toBe(1) // Collapsed
  })

  it('gives a dependency the reveal command, so a click lands on its line', () => {
    const tree = paneOver([scanOf('/repo/package.json', [dep()])])
    const item = tree.getTreeItem(tree.getChildren(tree.getChildren()[0])[0]) as {
      command?: { command: string; arguments: unknown[] }
    }
    expect(item.command?.command).toBe('depwatch.reveal')
    expect(item.command?.arguments).toEqual(['/repo/package.json', 'left-pad'])
  })
})
