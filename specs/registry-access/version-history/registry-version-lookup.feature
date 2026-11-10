@domain:registry-access @area:version-history @from:lib/registry-client
Feature: Looking up published versions from package registries
  Gives anyone running a check the true list of releases and their dates for npm, PyPI, crates.io, Packagist and RubyGems packages, so drift and release activity are measured against what was actually published, and a lookup that fails says why.

  Background:
    Given the package's ecosystem is one of npm, PyPI, crates.io, Packagist or RubyGems

  @id:registry-access.version-history.003 @rule:registry.versions.withdrawn-releases-excluded @inferred @source:src/lib/registry-client.ts#fetchPackage
  Scenario Outline: Releases withdrawn from the registry do not count as published versions
    Given the package "<package>" is published on <registry>
    And its release <release> is <state>
    When the operator checks a manifest that depends on "<package>"
    Then release <release> is not among the package's published versions
    And release <release> is never reported as the latest version

    Examples:
      | registry  | package          | release | state                         |
      | crates.io | serde-example    | 1.0.9   | yanked                        |
      | PyPI      | requests-example | 2.4.0   | yanked in every uploaded file |
      | PyPI      | requests-example | 2.5.0   | listed with no uploaded files |

  @id:registry-access.version-history.004 @rule:registry.versions.pypi-release-date-from-first-file @inferred @source:src/lib/registry-client.ts#fetchPackage
  Scenario: A PyPI release is dated by its first available upload
    Given the PyPI package "flask-example" release 3.0.0 lists first a non-yanked file uploaded at 2024-03-01T10:00:00Z
    And a second file for 3.0.0, listed after it, was uploaded at 2024-03-05T09:00:00Z
    When the operator checks a manifest that depends on "flask-example"
    Then release 3.0.0 is dated 2024-03-01T10:00:00Z

  @id:registry-access.version-history.005 @rule:registry.versions.packagist-v-prefix-stripped @inferred @source:src/lib/registry-client.ts#fetchPackage
  Scenario: Packagist versions tagged with a leading "v" are reported without it
    Given the Packagist package "acme/http-client" publishes the version tag "v2.3.1"
    When the operator checks a manifest that depends on "acme/http-client"
    Then the package's published versions include "2.3.1"
    And no published version is listed as "v2.3.1"
