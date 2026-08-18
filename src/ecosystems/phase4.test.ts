import { describe, expect, it } from 'vitest'
import { parse } from '../manifest.js'

describe('go', () => {
  it('reads require blocks and single requires, dropping // indirect', () => {
    const m = parse(
      'go.mod',
      `module example.com/app

go 1.21

require (
	github.com/pkg/errors v0.9.1
	golang.org/x/net v0.17.0 // indirect
)

require github.com/spf13/cobra v1.8.0
`,
    )
    expect(m.ecosystem).toBe('go')
    expect(m.deps).toEqual([
      { name: 'github.com/pkg/errors', current: 'v0.9.1', resolved: true },
      { name: 'golang.org/x/net', current: 'v0.17.0', resolved: true },
      { name: 'github.com/spf13/cobra', current: 'v1.8.0', resolved: true },
    ])
  })
})

describe('maven', () => {
  it('reads pom.xml dependencies and skips property versions', () => {
    const m = parse(
      'pom.xml',
      `<project>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.0.0-jre</version>
    </dependency>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>managed</artifactId>
      <version>\${managed.version}</version>
    </dependency>
  </dependencies>
</project>`,
    )
    expect(m.ecosystem).toBe('maven')
    expect(m.deps).toEqual([{ name: 'com.google.guava:guava', current: '33.0.0-jre', resolved: false }])
  })

  it('reads gradle declarations and the gradle.lockfile', () => {
    const g = parse('build.gradle', `dependencies {\n  implementation 'com.google.guava:guava:33.0.0-jre'\n  api("org.slf4j:slf4j-api:2.0.9")\n}`)
    expect(g.deps).toEqual([
      { name: 'com.google.guava:guava', current: '33.0.0-jre', resolved: false },
      { name: 'org.slf4j:slf4j-api', current: '2.0.9', resolved: false },
    ])
    const lock = parse('gradle.lockfile', `com.google.guava:guava:33.0.0-jre=compileClasspath\norg.slf4j:slf4j-api:2.0.9=runtimeClasspath\nempty=`)
    expect(lock.deps).toEqual([
      { name: 'com.google.guava:guava', current: '33.0.0-jre', resolved: true },
      { name: 'org.slf4j:slf4j-api', current: '2.0.9', resolved: true },
    ])
  })
})

describe('terraform', () => {
  it('reads .terraform.lock.hcl providers and skips private registries', () => {
    const m = parse(
      '.terraform.lock.hcl',
      `provider "registry.terraform.io/hashicorp/aws" {
  version     = "5.31.0"
  constraints = "~> 5.0"
}

provider "app.terraform.io/acme/private" {
  version = "1.0.0"
}`,
    )
    expect(m.ecosystem).toBe('terraform')
    expect(m.deps).toEqual([{ name: 'hashicorp/aws', current: '5.31.0', resolved: true }])
  })

  it('reads required_providers ranges from a .tf file', () => {
    const m = parse(
      'main.tf',
      `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.31"
    }
  }
}`,
    )
    expect(m.deps).toEqual([{ name: 'hashicorp/aws', current: '5.31', resolved: false }])
  })
})

describe('github actions', () => {
  it('reads uses refs from a workflow, skipping local and docker', () => {
    const m = parse(
      '.github/workflows/ci.yml',
      `jobs:
  build:
    steps:
      - uses: actions/checkout@v4.1.1
      - uses: actions/setup-node@v4
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.19
      - uses: some/reusable/.github/workflows/wf.yml@v1`,
    )
    expect(m.ecosystem).toBe('githubactions')
    expect(m.deps).toEqual([
      { name: 'actions/checkout', current: 'v4.1.1', resolved: true },
      { name: 'actions/setup-node', current: 'v4', resolved: false },
      { name: 'some/reusable', current: 'v1', resolved: false },
    ])
  })
})

describe('maven coordinates', () => {
  it('parses both group:artifact and PURL group/artifact via the SBOM path', async () => {
    const { parseSbom } = await import('../sbom.js')
    const parsed = parseSbom(
      JSON.stringify({
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        metadata: { component: { 'bom-ref': 'root', name: 'app' } },
        components: [
          { 'bom-ref': 'c1', name: 'guava', version: '30.0-jre', purl: 'pkg:maven/com.google.guava/guava@30.0-jre' },
        ],
      }),
    )
    expect(parsed?.components).toEqual([
      { name: 'com.google.guava/guava', current: '30.0-jre', resolved: true, ecosystem: 'maven', ref: 'c1' },
    ])
  })
})

describe('maven version ordering', () => {
  it('orders qualifiers and stable releases the Maven way', async () => {
    const { mavenOps } = await import('./maven.js')
    const sorted = (vs: string[]) => [...vs].sort(mavenOps.compare)
    expect(sorted(['33.0.0-jre', '10.0', 'r03', '33.7.1-jre'])).toEqual(['r03', '10.0', '33.0.0-jre', '33.7.1-jre'])
    // alpha < beta < rc < SNAPSHOT < release < sp
    expect(sorted(['1.0', '1.0-alpha', '1.0-rc1', '1.0-beta', '1.0-SNAPSHOT', '1.0-sp1'])).toEqual([
      '1.0-alpha', '1.0-beta', '1.0-rc1', '1.0-SNAPSHOT', '1.0', '1.0-sp1',
    ])
    expect(mavenOps.compare('1.0', '1.0.0')).toBe(0)
  })

  it('treats build qualifiers as stable and milestones as prerelease', async () => {
    const { mavenOps } = await import('./maven.js')
    for (const v of ['33.0.0-jre', '2.0.0.RELEASE', '1.5.0.Final', '1.0']) expect(mavenOps.isPrerelease(v)).toBe(false)
    for (const v of ['1.0-SNAPSHOT', '1.0-rc1', '1.0-alpha1', '1.0-M3']) expect(mavenOps.isPrerelease(v)).toBe(true)
  })
})
