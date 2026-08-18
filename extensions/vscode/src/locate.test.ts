import { describe, expect, it } from 'vitest'
import { locateDeps, shapeOf } from './locate.js'

// The span is what gets underlined, so every assertion here checks the text the
// editor would highlight rather than a raw offset.
const at = (text: string, filename: string, name: string): string | undefined => {
  const span = locateDeps(text, filename, [name]).get(name)
  return span && text.slice(span.start, span.end)
}

const lineOf = (text: string, filename: string, name: string): string | undefined => {
  const span = locateDeps(text, filename, [name]).get(name)
  if (!span) return undefined
  return text.slice(0, span.start).split('\n').pop()! + text.slice(span.start).split('\n')[0]
}

describe('shapeOf', () => {
  it('recognises the files depwatch reads', () => {
    expect(shapeOf('/a/b/package.json')).toBe('json-sections')
    expect(shapeOf('C:\\proj\\Cargo.lock')).toBe('cargo-lock')
    expect(shapeOf('requirements-dev.txt')).toBe('requirements')
    expect(shapeOf('Cargo.toml')).toBe('cargo-toml')
    expect(shapeOf('Gemfile.lock')).toBe('gemfile-lock')
    expect(shapeOf('bom.json')).toBe('generic')
  })
})

describe('package.json', () => {
  const pkg = `{
  "name": "demo",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "react": "^18.2.0",
    "@scope/thing": "1.0.0"
  },
  "devDependencies": {
    "vitest": "^4.0.0"
  }
}`

  it('finds names in every dependency section', () => {
    expect(at(pkg, 'package.json', 'react')).toBe('react')
    expect(at(pkg, 'package.json', '@scope/thing')).toBe('@scope/thing')
    expect(at(pkg, 'package.json', 'vitest')).toBe('vitest')
  })

  // The point of walking the sections rather than grepping: a package sharing a
  // name with a script must not land on the script.
  it('ignores keys outside the dependency sections', () => {
    const clash = `{
  "scripts": { "react": "echo no" },
  "dependencies": { "react": "^18.2.0" }
}`
    expect(lineOf(clash, 'package.json', 'react')).toContain('^18.2.0')
  })

  it('says nothing about a dependency that is not written down', () => {
    expect(at(pkg, 'package.json', 'lodash')).toBeUndefined()
  })

  // A version range with a brace in it must not end the object early.
  it('survives braces inside values', () => {
    const odd = `{"dependencies":{"a":"^1.0.0 || {2}","b":"2.0.0"}}`
    expect(at(odd, 'package.json', 'b')).toBe('b')
  })
})

describe('lock files', () => {
  it('reads Cargo.lock and Gemfile.lock', () => {
    const cargo = `[[package]]
name = "serde"
version = "1.0.219"
`
    expect(at(cargo, 'Cargo.lock', 'serde')).toBe('serde')

    const gems = `GEM
  specs:
    rails (7.1.3)
    activesupport (7.1.3)
`
    expect(at(gems, 'Gemfile.lock', 'activesupport')).toBe('activesupport')
  })
})

describe('other manifests', () => {
  it('reads Cargo.toml tables, including the [dependencies.name] form', () => {
    const toml = `[package]
name = "demo"

[dependencies]
serde = "1.0"
tokio = { version = "1.44", features = ["full"] }

[dependencies.regex]
version = "1.10"

[dev-dependencies]
criterion = "0.5"
`
    expect(at(toml, 'Cargo.toml', 'serde')).toBe('serde')
    expect(at(toml, 'Cargo.toml', 'tokio')).toBe('tokio')
    expect(at(toml, 'Cargo.toml', 'regex')).toBe('regex')
    expect(at(toml, 'Cargo.toml', 'criterion')).toBe('criterion')
    // [package] name = "demo" is not a dependency table.
    expect(lineOf(toml, 'Cargo.toml', 'demo')).toBeUndefined()
  })

  it('reads requirements.txt, including extras and markers', () => {
    const reqs = `# comment
requests==2.31.0
django[argon2]>=4.2 ; python_version >= "3.8"
`
    expect(at(reqs, 'requirements.txt', 'requests')).toBe('requests')
    expect(at(reqs, 'requirements.txt', 'django')).toBe('django')
  })

  it('reads composer.json require sections', () => {
    const composer = `{
  "require": { "monolog/monolog": "^3.5", "php": ">=8.1" },
  "require-dev": { "phpunit/phpunit": "^10.5" }
}`
    expect(at(composer, 'composer.json', 'monolog/monolog')).toBe('monolog/monolog')
    expect(at(composer, 'composer.json', 'phpunit/phpunit')).toBe('phpunit/phpunit')
  })

  // SBOMs have no shape worth special-casing; the name is a quoted string.
  it('falls back to the quoted name for an SBOM', () => {
    const bom = `{"components":[{"type":"library","name":"left-pad","version":"1.3.0"}]}`
    expect(at(bom, 'bom.json', 'left-pad')).toBe('left-pad')
  })

  // "pad" appears inside "left-pad", and underlining the middle of another
  // package's name is worse than underlining nothing.
  it('refuses a partial word match', () => {
    const bom = `{"components":[{"name":"left-pad"}]}`
    expect(at(bom, 'bom.json', 'pad')).toBeUndefined()
  })
})
