// The editor finds manifests by glob, and that list of globs is a second copy
// of something the ecosystem registry already knows. Copies drift: add an
// ecosystem to the engine, forget the glob, and the extension silently supports
// one fewer language than the CLI with no error anywhere to say so. This is the
// test that notices — it is why go.mod took until now to be picked up.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL } from '../../../src/ecosystems/registry.js'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const globs: string[] = manifest.contributes.configuration.properties['depwatch.manifests'].default
const activation: string[] = manifest.activationEvents

// The same basename-only comparison engine.ts makes: discovery has already
// decided which directories are in scope.
const covers = (glob: string, base: string): boolean =>
  new RegExp(
    `^${(glob.split('/').pop() ?? glob)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  ).test(base)

// Bundler and CocoaPods put the resolved versions in the lock and nowhere else,
// so for those two the lock *is* the manifest.
const discoverable = (def: (typeof ALL)[number]): string[] =>
  def.manifests.length > 0 ? def.manifests : def.locks

describe('depwatch.manifests defaults', () => {
  it.each(ALL.map((def) => [def.id, discoverable(def)] as const))('finds %s', (_id, names) => {
    for (const name of names) expect(globs.some((g) => covers(g, name))).toBe(true)
  })

  it('activates on everything it would scan', () => {
    // The SBOM globs are the exception: bom.json is detected by content, and no
    // repository is opened for the sake of one.
    const scanned = globs.filter((g) => !/bom\.json$|cdx\.json$/.test(g))
    for (const glob of scanned) expect(activation).toContain(`workspaceContains:${glob}`)
  })

  // Workflow files are parsed by the engine but deliberately left out of the
  // defaults: engine.ts compares basenames only, so the glob that would find
  // them matches every YAML file in the repository.
  it('leaves the workflow glob to whoever wants it', () => {
    expect(globs.some((g) => g.includes('.github/workflows'))).toBe(false)
  })
})
