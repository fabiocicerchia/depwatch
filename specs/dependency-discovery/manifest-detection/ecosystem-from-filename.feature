@domain:dependency-discovery @area:manifest-detection @from:ecosystems/registry
Feature: Recognising a dependency file's ecosystem from its name
  Lets a developer point depwatch at a manifest or lock file without naming its ecosystem, so the right registry and parser are chosen from the filename alone.

  Background:
    Given depwatch supports npm, PyPI, crates.io, Packagist, RubyGems, pub.dev, Hex, NuGet, CocoaPods, conda, Helm, Go modules, Maven Central, Terraform, GitHub Actions and Docker

  @id:dependency-discovery.manifest-detection.001 @rule:discovery.detection.ecosystem-from-filename @verified @source:src/ecosystems/registry.ts#byFile @test:src/ecosystems/registry.test.ts#resolves files to the right ecosystem
  Scenario Outline: A dependency file is assigned its ecosystem by filename, wherever it lives
    Given a project file at <path>
    When the developer checks <path> without forcing an ecosystem
    Then depwatch reads it as a <ecosystem> file

    Examples:
      | path                           | ecosystem |
      | package.json                   | npm       |
      | a/b/yarn.lock                  | npm       |
      | requirements-dev.txt           | PyPI      |
      | Cargo.lock                     | crates.io |
      | composer.json                  | Packagist |
      | Gemfile.lock                   | RubyGems  |
      | infra/main.tf                  | Terraform |
      | src/App/App.csproj             | NuGet     |
      | Dockerfile.prod                | Docker    |
      | C:\work\shop\package-lock.json | npm       |

  @id:dependency-discovery.manifest-detection.002 @rule:discovery.detection.workflow-files-by-directory @inferred @source:src/ecosystems/registry.ts#byFile
  Scenario Outline: A workflow file is recognised as GitHub Actions only inside .github/workflows
    Given a YAML file named ci.yml at <path>
    When the developer checks <path> without forcing an ecosystem
    Then <outcome>

    Examples:
      | path                     | outcome                                    |
      | .github/workflows/ci.yml | depwatch reads it as a GitHub Actions file |
      | config/ci.yml            | depwatch refuses it as unrecognised input  |

  @id:dependency-discovery.manifest-detection.003 @rule:discovery.detection.unrecognised-file-refused @verified @source:src/ecosystems/registry.ts#byFile @test:src/ecosystems/registry.test.ts#resolves files to the right ecosystem
  Scenario: A file no ecosystem recognises is refused rather than reported clean
    Given a file named deps.edn that is not an SBOM
    When the developer checks deps.edn without forcing an ecosystem
    Then depwatch refuses with "unrecognised input: deps.edn (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)"
    And no dependency report is produced
