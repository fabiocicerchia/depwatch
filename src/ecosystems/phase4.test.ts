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
