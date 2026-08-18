import { describe, expect, it } from 'vitest'
import { detectSbom, directOnly, parsePurl, parseSbom } from './sbom.js'
import { parse } from './manifest.js'

// Shapes taken from real syft output (cyclonedx-json 1.7, spdx-json 2.3).
const CDX = {
  bomFormat: 'CycloneDX',
  specVersion: '1.7',
  metadata: { component: { 'bom-ref': 'root-ref', type: 'file', name: 'my-app' } },
  components: [
    { 'bom-ref': 'ref-react', type: 'library', name: 'react', version: '18.3.9', purl: 'pkg:npm/react@18.3.9' },
    { 'bom-ref': 'ref-router', type: 'library', name: '@remix-run/router', version: '1.23.3', purl: 'pkg:npm/%40remix-run/router@1.23.3' },
    { 'bom-ref': 'ref-django', type: 'library', name: 'django', version: '4.2.1', purl: 'pkg:pypi/django@4.2.1' },
    { 'bom-ref': 'ref-serde', type: 'library', name: 'serde', version: '1.0.219', purl: 'pkg:cargo/serde@1.0.219' },
    { 'bom-ref': 'ref-go', type: 'library', name: 'golang.org/x/net', version: 'v0.1.0', purl: 'pkg:golang/golang.org/x/net@v0.1.0' },
    { 'bom-ref': 'ref-gha', type: 'library', name: 'actions/checkout', version: 'v7', purl: 'pkg:github/actions/checkout@v7' },
    // An OS package: no registry depwatch can query, so it stays skipped.
    { 'bom-ref': 'ref-deb', type: 'library', name: 'libssl3', version: '3.0.11', purl: 'pkg:deb/debian/libssl3@3.0.11' },
    // syft catalogues the scanned project itself when given a directory.
    { 'bom-ref': 'ref-self', type: 'library', name: 'my-app', version: '0.1.0', purl: 'pkg:npm/my-app@0.1.0' },
  ],
  dependencies: [{ ref: 'root-ref', dependsOn: ['ref-react', 'ref-django'] }],
}

const SPDX = {
  spdxVersion: 'SPDX-2.3',
  name: 'my-app',
  documentDescribes: ['SPDXRef-root'],
  packages: [
    { SPDXID: 'SPDXRef-root', name: 'my-app', versionInfo: '0.1.0' },
    {
      SPDXID: 'SPDXRef-react',
      name: 'react',
      versionInfo: '18.3.9',
      externalRefs: [
        { referenceCategory: 'SECURITY', referenceType: 'cpe23Type', referenceLocator: 'cpe:2.3:a:react' },
        { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:npm/react@18.3.9' },
      ],
    },
    {
      SPDXID: 'SPDXRef-go',
      name: 'golang.org/x/net',
      versionInfo: 'v0.1.0',
      externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:golang/golang.org/x/net@v0.1.0' }],
    },
    {
      SPDXID: 'SPDXRef-deb',
      name: 'libssl3',
      versionInfo: '3.0.11',
      externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:deb/debian/libssl3@3.0.11' }],
    },
  ],
  relationships: [{ spdxElementId: 'SPDXRef-root', relatedSpdxElement: 'SPDXRef-react', relationshipType: 'DEPENDS_ON' }],
}

describe('parsePurl', () => {
  it('reads type, name and version', () => {
    expect(parsePurl('pkg:npm/react@18.3.9')).toEqual({ type: 'npm', name: 'react', version: '18.3.9' })
    expect(parsePurl('pkg:cargo/serde@1.0.219')).toEqual({ type: 'cargo', name: 'serde', version: '1.0.219' })
  })

  it('decodes a percent-encoded npm scope, which is how syft writes them', () => {
    expect(parsePurl('pkg:npm/%40remix-run/router@1.23.3')).toEqual({
      type: 'npm',
      name: '@remix-run/router',
      version: '1.23.3',
    })
  })

  it('accepts an unencoded scope too', () => {
    expect(parsePurl('pkg:npm/@types/node@22.0.0')?.name).toBe('@types/node')
  })

  it('drops qualifiers and subpaths, which are not part of identity', () => {
    expect(parsePurl('pkg:npm/react@18.3.9?arch=x86#src/lib')).toEqual({ type: 'npm', name: 'react', version: '18.3.9' })
  })

  it('returns null rather than guessing', () => {
    expect(parsePurl('not-a-purl')).toBeNull()
    expect(parsePurl('pkg:npm/react')).toBeNull() // no version
    expect(parsePurl('pkg:npm')).toBeNull()
  })
})

describe('detectSbom', () => {
  it('tells the two formats apart, and from everything else', () => {
    expect(detectSbom(JSON.stringify(CDX))).toBe('cyclonedx')
    expect(detectSbom(JSON.stringify(SPDX))).toBe('spdx')
    expect(detectSbom(JSON.stringify({ dependencies: { react: '^18.0.0' } }))).toBeNull()
    expect(detectSbom('{not json')).toBeNull()
    expect(detectSbom('')).toBeNull()
  })
})

describe('CycloneDX', () => {
  const parsed = parseSbom(JSON.stringify(CDX))!

  it('keeps components whose ecosystem has a reachable registry', () => {
    expect(parsed.components.map((c) => c.name).sort()).toEqual([
      '@remix-run/router',
      'actions/checkout',
      'django',
      'golang.org/x/net',
      'react',
      'serde',
    ])
  })

  it('maps each component to its own ecosystem', () => {
    const byName = Object.fromEntries(parsed.components.map((c) => [c.name, c.ecosystem]))
    expect(byName).toMatchObject({ react: 'npm', django: 'pep440', serde: 'cargo' })
  })

  it('marks every SBOM version as resolved — that is what an SBOM is for', () => {
    expect(parsed.components.every((c) => c.resolved)).toBe(true)
  })

  // Silently dropping two thirds of an SBOM would look like a clean result.
  it('counts what it skipped, by ecosystem', () => {
    expect(parsed.skipped).toEqual({ deb: 1 })
  })

  it('excludes the scanned project from its own dependencies', () => {
    expect(parsed.components.map((c) => c.name)).not.toContain('my-app')
  })

  it('reads the dependency graph to find direct dependencies', () => {
    expect(directOnly(parsed).map((c) => c.name).sort()).toEqual(['django', 'react'])
  })

  it('falls back to everything when the graph is absent or matches nothing', () => {
    const noGraph = parseSbom(JSON.stringify({ ...CDX, dependencies: [] }))!
    expect(directOnly(noGraph)).toHaveLength(6)

    const brokenGraph = parseSbom(JSON.stringify({ ...CDX, dependencies: [{ ref: 'root-ref', dependsOn: ['nope'] }] }))!
    expect(directOnly(brokenGraph)).toHaveLength(6)
  })
})

describe('SPDX', () => {
  const parsed = parseSbom(JSON.stringify(SPDX))!

  it('reads purls out of externalRefs, ignoring the cpe entries', () => {
    expect(parsed.components.map((c) => c.name)).toEqual(['react', 'golang.org/x/net'])
    expect(parsed.components[0]).toMatchObject({ current: '18.3.9', ecosystem: 'npm', resolved: true })
  })

  it('skips the document root and counts unsupported ecosystems', () => {
    expect(parsed.components.map((c) => c.name)).not.toContain('my-app')
    expect(parsed.skipped).toEqual({ deb: 1 })
  })

  it('reads DEPENDS_ON relationships as the direct set', () => {
    expect(directOnly(parsed).map((c) => c.name)).toEqual(['react'])
  })

  it('reads the reversed DEPENDENCY_OF spelling too', () => {
    const reversed = parseSbom(
      JSON.stringify({
        ...SPDX,
        relationships: [
          { spdxElementId: 'SPDXRef-react', relatedSpdxElement: 'SPDXRef-root', relationshipType: 'DEPENDENCY_OF' },
        ],
      }),
    )!
    expect(directOnly(reversed).map((c) => c.name)).toEqual(['react'])
  })
})

describe('parse() accepts an SBOM by content, not filename', () => {
  it('reads bom.json as an SBOM rather than a package.json', () => {
    const m = parse('bom.json', JSON.stringify(CDX))
    expect(m.sbom?.format).toBe('cyclonedx')
    expect(m.deps.map((d) => d.name).sort()).toEqual(['django', 'react'])
    expect(m.sbom?.scoped).toBe(true)
    expect(m.sbom?.total).toBe(6)
  })

  it('takes the whole tree when asked', () => {
    const m = parse('bom.json', JSON.stringify(CDX), undefined, true)
    expect(m.deps).toHaveLength(6)
    expect(m.sbom?.scoped).toBe(false)
  })

  it('still reads a real manifest as a manifest', () => {
    const m = parse('package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }))
    expect(m.sbom).toBeUndefined()
    expect(m.deps[0].resolved).toBe(false)
  })
})
