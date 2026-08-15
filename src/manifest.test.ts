import { describe, expect, it } from 'vitest'
import { assertEcosystem, detectEcosystem, parse, SUPPORTED_ECOSYSTEMS } from './manifest.js'
import { quadrantSVG } from './quadrant.js'
import type { DepReport } from './report.js'
import { NO_SIGNALS } from './viability.js'

describe('detectEcosystem', () => {
  it('maps conventional manifest names', () => {
    expect(detectEcosystem('package.json')).toBe('npm')
    expect(detectEcosystem('a/b/requirements-dev.txt')).toBe('pep440')
    expect(detectEcosystem('Cargo.toml')).toBe('cargo')
    expect(detectEcosystem('composer.json')).toBe('composer')
    expect(detectEcosystem('Gemfile.lock')).toBe('rubygems')
    expect(detectEcosystem('pom.xml')).toBeNull()
  })

  it('refuses to guess at an unknown manifest', () => {
    expect(() => parse('pom.xml', '<project/>')).toThrow(/unrecognised input/)
  })
})

describe('parse', () => {
  it('reads npm manifests through the shared engine', () => {
    const m = parse('package.json', JSON.stringify({ dependencies: { react: '^18.3.1' }, devDependencies: { vitest: '~2.1.2' } }))
    expect(m.ecosystem).toBe('npm')
    expect(m.deps).toEqual([
      { name: 'react', current: '18.3.1', resolved: false },
      { name: 'vitest', current: '2.1.2', resolved: false },
    ])
  })

  it('reads Cargo dependency tables in all three spellings', () => {
    const m = parse(
      'Cargo.toml',
      `[package]
name = "thing"
version = "0.1.0"

[dependencies]
serde = "1.0.200"
tokio = { version = "1.38", features = ["full"] }

[dev-dependencies]
criterion = "0.5.1"

[dependencies.reqwest]
version = "0.12.4"
default-features = false
`,
    )
    expect(m.deps).toEqual([
      { name: 'serde', current: '1.0.200', resolved: false },
      { name: 'tokio', current: '1.38', resolved: false },
      { name: 'criterion', current: '0.5.1', resolved: false },
      { name: 'reqwest', current: '0.12.4', resolved: false },
    ])
  })

  it('ignores the package version and platform requirements', () => {
    const m = parse('composer.json', JSON.stringify({ require: { php: '>=8.1', 'ext-json': '*', 'monolog/monolog': '^3.5.0' } }))
    expect(m.deps).toEqual([{ name: 'monolog/monolog', current: '3.5.0', resolved: false }])
  })

  it('reads pinned versions from Gemfile.lock specs, not its dependency lines', () => {
    const m = parse(
      'Gemfile.lock',
      `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3)
      activesupport (= 7.1.3)
    activesupport (7.1.3)

PLATFORMS
  ruby

DEPENDENCIES
  rails (~> 7.1)
`,
    )
    expect(m.deps).toEqual([
      // Gemfile.lock is itself a lock file, so these are exact.
      { name: 'rails', current: '7.1.3', resolved: true },
      { name: 'activesupport', current: '7.1.3', resolved: true },
    ])
  })
})

describe('quadrantSVG', () => {
  const dep = (over: Partial<DepReport>): DepReport => ({
    name: 'x',
    current: '1.0.0',
    latest: '2.0.0',
    libyearsBehind: 0,
    resolved: true,
    currentReleased: null,
    latestReleased: null,
    pulseYears: 0,
    viability: 1,
    quadrant: 'healthy',
    signals: { ...NO_SIGNALS },
    ...over,
  })

  it('plots scored deps and notes the ones it could not score', () => {
    const svg = quadrantSVG([
      dep({ name: 'alive' }),
      dep({ name: 'doomed', libyearsBehind: 4, viability: 0.1, quadrant: 'replace' }),
      dep({ name: 'unknown', degraded: 'registry unreachable' }),
    ])
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('doomed') // off-quadrant points are labelled
    expect(svg).not.toContain('>alive<') // healthy ones are not, by default
    expect(svg).toContain('1 not plotted')
  })

  it('escapes package names rather than emitting raw markup', () => {
    const svg = quadrantSVG([dep({ name: '<script>&', quadrant: 'replace', libyearsBehind: 4, viability: 0.1 })])
    expect(svg).toContain('&lt;script&gt;&amp;')
    expect(svg).not.toContain('<script>')
  })

  // The worst dependencies plot furthest right, so a label that runs off the
  // right edge is always the name you most wanted to read.
  it('flips a label to the left of a point that would clip it', () => {
    const svg = quadrantSVG([dep({ name: 'a-very-long-package-name', libyearsBehind: 8, quadrant: 'upgrade' })])
    const label = svg.match(/<text x="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>a-very-long-package-name<\/text>/)
    expect(label?.[2]).toBe('end')
    expect(Number(label?.[1])).toBeLessThan(760)
  })

  it('keeps a label on the right when there is room', () => {
    const svg = quadrantSVG([dep({ name: 'ab', libyearsBehind: 0.1, quadrant: 'upgrade' })])
    expect(svg).toMatch(/text-anchor="start"[^>]*>ab<\/text>/)
  })
})

// gandalf finding: --eco was cast straight to the union type, so a typo reached
// a switch that matched no case and reported an empty manifest as clean.
describe('assertEcosystem', () => {
  it('accepts every supported ecosystem', () => {
    for (const eco of SUPPORTED_ECOSYSTEMS) {
      expect(assertEcosystem(eco)).toBe(eco)
    }
  })

  it('rejects a typo instead of silently reporting no dependencies', () => {
    expect(() => assertEcosystem('npmm')).toThrow(/unsupported ecosystem "npmm"/)
    expect(() => assertEcosystem('')).toThrow(/unsupported ecosystem/)
    expect(() => assertEcosystem('maven')).toThrow(/want one of/)
  })
})
