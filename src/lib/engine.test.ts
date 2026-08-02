import { describe, expect, it } from 'vitest'
import { compareVersions, isPrerelease } from './semver.js'
import { buildReport, detectKind, libyearsForDep, parseManifest } from './libyear/engine.js'
import type { RegistryVersion } from './registry-client.js'

const v = (version: string, released: string | null = null): RegistryVersion => ({ version, released })

describe('version ordering', () => {
  it('ranks by the numeric core, not by string', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.2', '1.2.0')).toBe(0) // a range floor and its release
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
  })

  it('puts a release ahead of its own prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(isPrerelease('1.0.0-rc.1')).toBe(true)
    expect(isPrerelease('2.0.0b1')).toBe(true) // PEP 440 beta, no separator
    expect(isPrerelease('1.2.3+build.5')).toBe(false) // build metadata only
    expect(isPrerelease('1.2.post1')).toBe(false) // ships after 1.2, not before
  })
})

describe('libyearsForDep', () => {
  const versions = [
    v('1.0.0', '2022-01-01T00:00:00Z'),
    v('2.0.0', '2024-01-01T00:00:00Z'),
    v('3.0.0-rc.1', '2024-06-01T00:00:00Z'),
  ]
  const asOf = Date.parse('2025-01-01T00:00:00Z')

  it('measures the age gap between what you run and what is current', () => {
    const d = libyearsForDep({ name: 'x', current: '1.0.0', resolved: true }, versions, asOf)
    expect(d.latest).toBe('2.0.0') // the prerelease is not "current"
    expect(d.libyearsBehind).toBe(2)
    expect(d.pulseYears).toBe(1)
  })

  it('matches a range floor to the release it names', () => {
    // "^1.0" reduces to "1.0", which is not a published version string.
    expect(libyearsForDep({ name: 'x', current: '1.0', resolved: false }, versions, asOf).libyearsBehind).toBe(2)
  })

  it('reports unknown as zero rather than guessing', () => {
    const d = libyearsForDep({ name: 'x', current: '1.0.0', resolved: true }, [v('1.0.0'), v('2.0.0')], asOf)
    expect(d.libyearsBehind).toBe(0)
    expect(d.pulseYears).toBeNull()
  })

  it('never reports negative drift when you run ahead of latest', () => {
    const d = libyearsForDep({ name: 'x', current: '2.0.0', resolved: true }, versions, asOf)
    expect(d.libyearsBehind).toBe(0)
  })

  it('totals drift across the manifest', () => {
    const deps = [
      libyearsForDep({ name: 'a', current: '1.0.0', resolved: true }, versions, asOf),
      libyearsForDep({ name: 'b', current: '2.0.0', resolved: true }, versions, asOf),
    ]
    const r = buildReport(deps)
    expect(r.totalLibyears).toBe(2)
    expect(r.worst[0].name).toBe('a')
  })
})

describe('detectKind', () => {
  it('tells a lock file from the manifest beside it', () => {
    expect(detectKind('{"lockfileVersion":3,"packages":{}}')).toBe('package-lock')
    expect(detectKind('{"dependencies":{"react":"^18.0.0"}}')).toBe('npm')
    expect(detectKind('# yarn lockfile v1\n')).toBe('yarn-lock')
    expect(detectKind("lockfileVersion: '6.0'\n")).toBe('pnpm-lock')
    expect(detectKind('not json at all')).toBeNull()
  })
})

describe('parseManifest', () => {
  it('reads package.json ranges as unresolved floors', () => {
    const deps = parseManifest(
      JSON.stringify({
        dependencies: { react: '^18.3.1', local: 'file:../x', tagged: 'user/repo#v1.2.3' },
        devDependencies: { vitest: '~2.1.2' },
      }),
      'npm',
    )
    expect(deps).toEqual([
      { name: 'react', current: '18.3.1', resolved: false },
      { name: 'vitest', current: '2.1.2', resolved: false },
    ])
  })

  it('reads package-lock v3 paths and v1 trees alike', () => {
    const v3 = parseManifest(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'self' }, 'node_modules/react': { version: '18.3.1' } },
      }),
      'package-lock',
    )
    expect(v3).toEqual([{ name: 'react', current: '18.3.1', resolved: true }])

    const v1 = parseManifest(
      JSON.stringify({ lockfileVersion: 1, dependencies: { react: { version: '18.3.1' } } }),
      'package-lock',
    )
    expect(v1).toEqual([{ name: 'react', current: '18.3.1', resolved: true }])
  })

  it('reads yarn v1 and berry entries, scopes included', () => {
    const yarn = parseManifest('# yarn lockfile v1\n\n"@scope/pkg@^1.0.0", "@scope/pkg@^1.2.0":\n  version "1.2.3"\n', 'yarn-lock')
    expect(yarn).toEqual([{ name: '@scope/pkg', current: '1.2.3', resolved: true }])

    const berry = parseManifest('__metadata:\n  version: 6\n\n"react@npm:^18.0.0":\n  version: 18.3.1\n', 'yarn-lock')
    expect(berry).toContainEqual({ name: 'react', current: '18.3.1', resolved: true })
  })

  it('reads both pnpm key spellings and drops peer suffixes', () => {
    const v6 = parseManifest("lockfileVersion: '6.0'\n\npackages:\n\n  /@scope/pkg/1.2.3(react@18.0.0):\n    dev: false\n", 'pnpm-lock')
    expect(v6).toEqual([{ name: '@scope/pkg', current: '1.2.3', resolved: true }])

    const v9 = parseManifest("lockfileVersion: '9.0'\n\npackages:\n\n  react@18.3.1:\n    resolution: {}\n", 'pnpm-lock')
    expect(v9).toEqual([{ name: 'react', current: '18.3.1', resolved: true }])
  })

  it('resolves == pins in requirements.txt but not the other operators', () => {
    const deps = parseManifest('-r base.txt\n# comment\nrequests==2.31.0\nflask[async] >= 3.0  # inline\n', 'pep440')
    expect(deps).toEqual([
      { name: 'requests', current: '2.31.0', resolved: true },
      { name: 'flask', current: '3.0', resolved: false },
    ])
  })
})
