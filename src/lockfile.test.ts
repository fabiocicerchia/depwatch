import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInput } from './cli.js'
import { detectEcosystem, parse } from './manifest.js'

const flags = (over = {}) =>
  ({ json: false, deep: false, ci: false, labelAll: false, noLock: false, transitive: false, thresholds: { staleLibyears: 1, riskyViability: 0.5 }, ...over }) as any

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'depwatch-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

describe('resolveInput', () => {
  // Reading a range's floor as the installed version overstates drift, so the
  // lock file beside the manifest wins by default.
  it('prefers the lock file sitting next to the manifest', () => {
    const dir = project({ 'package.json': '{"dependencies":{}}', 'package-lock.json': '{"lockfileVersion":3}' })
    expect(resolveInput(join(dir, 'package.json'), flags())).toBe(join(dir, 'package-lock.json'))
  })

  it('honours the yarn and pnpm lock files too', () => {
    const yarn = project({ 'package.json': '{}', 'yarn.lock': '# yarn lockfile v1' })
    expect(resolveInput(join(yarn, 'package.json'), flags())).toBe(join(yarn, 'yarn.lock'))
    const pnpm = project({ 'package.json': '{}', 'pnpm-lock.yaml': "lockfileVersion: '6.0'" })
    expect(resolveInput(join(pnpm, 'package.json'), flags())).toBe(join(pnpm, 'pnpm-lock.yaml'))
  })

  it('leaves the manifest alone when there is no lock file', () => {
    const dir = project({ 'package.json': '{}' })
    expect(resolveInput(join(dir, 'package.json'), flags())).toBe(join(dir, 'package.json'))
  })

  it('respects --no-lock', () => {
    const dir = project({ 'package.json': '{}', 'package-lock.json': '{}' })
    expect(resolveInput(join(dir, 'package.json'), flags({ noLock: true }))).toBe(join(dir, 'package.json'))
  })

  it('does not redirect a lock file to itself', () => {
    const dir = project({ 'package-lock.json': '{}' })
    expect(resolveInput(join(dir, 'package-lock.json'), flags())).toBe(join(dir, 'package-lock.json'))
  })

  it('finds Cargo.lock and composer.lock', () => {
    const cargo = project({ 'Cargo.toml': '[dependencies]', 'Cargo.lock': '' })
    expect(resolveInput(join(cargo, 'Cargo.toml'), flags())).toBe(join(cargo, 'Cargo.lock'))
    const composer = project({ 'composer.json': '{}', 'composer.lock': '{}' })
    expect(resolveInput(join(composer, 'composer.json'), flags())).toBe(join(composer, 'composer.lock'))
  })
})

describe('lock file parsing', () => {
  it('reads exact versions from Cargo.lock', () => {
    const lock = `[[package]]
name = "serde"
version = "1.0.219"

[[package]]
name = "tokio"
version = "1.44.2"
`
    const m = parse('Cargo.lock', lock)
    expect(m.deps).toEqual([
      { name: 'serde', current: '1.0.219', resolved: true },
      { name: 'tokio', current: '1.44.2', resolved: true },
    ])
  })

  it('reads exact versions from composer.lock, including dev', () => {
    const lock = JSON.stringify({
      packages: [{ name: 'monolog/monolog', version: '3.5.2' }],
      'packages-dev': [{ name: 'phpunit/phpunit', version: 'v10.5.1' }],
    })
    const m = parse('composer.lock', lock)
    expect(m.deps).toContainEqual({ name: 'monolog/monolog', current: '3.5.2', resolved: true })
    expect(m.deps).toContainEqual({ name: 'phpunit/phpunit', current: '10.5.1', resolved: true })
  })

  it('recognises lock files as their ecosystem', () => {
    expect(detectEcosystem('Cargo.lock')).toBe('cargo')
    expect(detectEcosystem('composer.lock')).toBe('composer')
    expect(detectEcosystem('a/b/package-lock.json')).toBe('npm')
    expect(detectEcosystem('yarn.lock')).toBe('npm')
  })

  // The versions a manifest yields are floors; the lock's are exact.
  it('marks manifest versions unresolved and lock versions resolved', () => {
    expect(parse('package.json', '{"dependencies":{"react":"^18.0.0"}}').deps[0].resolved).toBe(false)
    expect(parse('Gemfile.lock', 'GEM\n  specs:\n    rails (7.1.3)\n').deps[0].resolved).toBe(true)
  })
})
