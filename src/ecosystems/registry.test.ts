import { describe, expect, it } from 'vitest'
import { ALL, byFile, byId, byPurlType, ECO_IDS, isEcoId, REGISTRY } from './registry.js'

describe('ecosystem registry', () => {
  it('every def id matches its REGISTRY key and is unique', () => {
    for (const [key, def] of Object.entries(REGISTRY)) expect(def.id).toBe(key)
    expect(new Set(ALL.map((d) => d.id)).size).toBe(ALL.length)
  })

  it('has no PURL type claimed by two ecosystems', () => {
    const seen = new Map<string, string>()
    for (const def of ALL)
      for (const t of def.purlTypes) {
        expect(seen.has(t)).toBe(false)
        seen.set(t, def.id)
      }
  })

  it('has no filename claimed by two ecosystems', () => {
    const seen = new Set<string>()
    for (const def of ALL)
      for (const f of [...def.manifests, ...def.locks]) {
        expect(seen.has(f)).toBe(false)
        seen.add(f)
      }
  })

  it('resolves files to the right ecosystem', () => {
    expect(byFile('package.json')?.id).toBe('npm')
    expect(byFile('a/b/yarn.lock')?.id).toBe('npm')
    expect(byFile('requirements-dev.txt')?.id).toBe('pep440')
    expect(byFile('Cargo.lock')?.id).toBe('cargo')
    expect(byFile('composer.json')?.id).toBe('composer')
    expect(byFile('Gemfile.lock')?.id).toBe('rubygems')
    expect(byFile('pom.xml')).toBeNull()
  })

  it('maps PURL types', () => {
    expect(byPurlType('pypi')?.id).toBe('pep440')
    expect(byPurlType('gem')?.id).toBe('rubygems')
    expect(byPurlType('golang')).toBeNull()
  })

  it('validates ecosystem ids', () => {
    for (const id of ECO_IDS) expect(isEcoId(id)).toBe(true)
    expect(isEcoId('maven')).toBe(false)
    expect(byId('nope')).toBeNull()
  })
})
