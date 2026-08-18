import { describe, expect, it } from 'vitest'
import { parse } from '../manifest.js'

describe('pub.dev', () => {
  it('reads pubspec.lock exact versions', () => {
    const m = parse(
      'pubspec.lock',
      `packages:
  http:
    dependency: "direct main"
    source: hosted
    version: "1.2.0"
  meta:
    dependency: transitive
    version: "1.12.0"
sdks:
  dart: ">=3.0.0 <4.0.0"`,
    )
    expect(m.ecosystem).toBe('pub')
    expect(m.deps).toEqual([
      { name: 'http', current: '1.2.0', resolved: true },
      { name: 'meta', current: '1.12.0', resolved: true },
    ])
  })

  it('reads pubspec.yaml ranges and skips sdk deps', () => {
    const m = parse(
      'pubspec.yaml',
      `name: app
dependencies:
  http: ^1.2.0
  flutter:
    sdk: flutter
dev_dependencies:
  test: ">=1.24.0 <2.0.0"`,
    )
    expect(m.deps).toEqual([
      { name: 'http', current: '1.2.0', resolved: false },
      { name: 'test', current: '1.24.0', resolved: false },
    ])
  })
})

describe('hex', () => {
  it('reads mix.lock :hex entries', () => {
    const m = parse(
      'mix.lock',
      `%{
  "phoenix": {:hex, :phoenix, "1.7.11", "hash1", [:mix], [], "hexpm", "hash2"},
  "ecto": {:hex, :ecto, "3.11.1", "hash3", [:mix], [], "hexpm", "hash4"},
}`,
    )
    expect(m.ecosystem).toBe('hex')
    expect(m.deps).toEqual([
      { name: 'phoenix', current: '1.7.11', resolved: true },
      { name: 'ecto', current: '3.11.1', resolved: true },
    ])
  })

  it('reads mix.exs deps and skips git/path deps', () => {
    const m = parse(
      'mix.exs',
      `defmodule App.MixProject do
  defp deps do
    [
      {:phoenix, "~> 1.7.0"},
      {:ecto, ">= 3.0.0", only: :test},
      {:local, path: "../local"},
      {:remote, github: "org/remote"}
    ]
  end
end`,
    )
    expect(m.deps).toEqual([
      { name: 'phoenix', current: '1.7.0', resolved: false },
      { name: 'ecto', current: '3.0.0', resolved: false },
    ])
  })
})

describe('nuget', () => {
  it('reads packages.lock.json resolved versions', () => {
    const m = parse(
      'packages.lock.json',
      JSON.stringify({
        version: 1,
        dependencies: {
          'net8.0': {
            'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.3' },
            Serilog: { type: 'Transitive', resolved: '3.1.1' },
          },
        },
      }),
    )
    expect(m.ecosystem).toBe('nuget')
    expect(m.deps).toEqual([
      { name: 'Newtonsoft.Json', current: '13.0.3', resolved: true },
      { name: 'Serilog', current: '3.1.1', resolved: true },
    ])
  })

  it('reads PackageReference from a .csproj (attribute and child forms)', () => {
    const m = parse(
      'App.csproj',
      `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog">
      <Version>3.1.1</Version>
    </PackageReference>
  </ItemGroup>
</Project>`,
    )
    expect(m.deps).toEqual([
      { name: 'Newtonsoft.Json', current: '13.0.3', resolved: false },
      { name: 'Serilog', current: '3.1.1', resolved: false },
    ])
  })
})

describe('cocoapods', () => {
  it('reads Podfile.lock PODS and collapses subspecs', () => {
    const m = parse(
      'Podfile.lock',
      `PODS:
  - Alamofire (5.8.1)
  - SnapKit (5.6.0)
DEPENDENCIES:
  - Alamofire (~> 5.8)
SPEC CHECKSUMS:
  Alamofire: abcdef`,
    )
    expect(m.ecosystem).toBe('cocoapods')
    expect(m.deps).toEqual([
      { name: 'Alamofire', current: '5.8.1', resolved: true },
      { name: 'SnapKit', current: '5.6.0', resolved: true },
    ])
  })
})

describe('conda', () => {
  it('reads environment.yml specs and skips python and pip block', () => {
    const m = parse(
      'environment.yml',
      `name: env
channels:
  - conda-forge
dependencies:
  - python=3.11
  - numpy=1.26.4
  - conda-forge::pandas>=2.0
  - pip:
    - requests==2.31.0`,
    )
    expect(m.ecosystem).toBe('conda')
    expect(m.deps).toEqual([
      { name: 'numpy', current: '1.26.4', resolved: true },
      { name: 'pandas', current: '2.0', resolved: false },
    ])
  })
})

describe('helm', () => {
  it('reads Chart.lock deps with the repo-qualified name', () => {
    const m = parse(
      'Chart.lock',
      `dependencies:
- name: redis
  repository: https://charts.bitnami.com/bitnami
  version: 17.11.3
- name: local-oci
  repository: oci://registry.example.com/charts
  version: 1.0.0
digest: sha256:abc
generated: "2023-06-19T10:00:00Z"`,
    )
    expect(m.ecosystem).toBe('helm')
    // oci:// dependency is skipped; the redis dep carries its repo in the name.
    expect(m.deps).toEqual([
      { name: 'https://charts.bitnami.com/bitnami#redis', current: '17.11.3', resolved: true },
    ])
  })
})
