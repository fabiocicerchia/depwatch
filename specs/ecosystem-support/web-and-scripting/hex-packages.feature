@domain:ecosystem-support @area:web-and-scripting @from:ecosystems/hex
Feature: Measuring Elixir and Erlang dependencies from Hex
  Elixir and Erlang teams get drift and viability for their Hex dependencies straight from mix.lock or mix.exs, so the two-axis report covers their stack too.

  Background:
    Given the project is an Elixir project whose dependencies come from Hex

  @id:ecosystem-support.web-and-scripting.007 @rule:hex.manifests.lock-pins-exact-versions @verified @source:src/ecosystems/hex.ts#parseMixLock @test:src/ecosystems/phase3.test.ts#reads mix.lock :hex entries
  Scenario Outline: A mix.lock reports every Hex package at its pinned version
    Given a mix.lock pinning <package> from Hex at <pinned>
    And a mix.lock entry for a package fetched from git
    When the operator checks the mix.lock
    Then the report lists <package> under the Hex ecosystem at version <pinned>, marked as resolved
    And the git-sourced package is not listed

    Examples:
      | package | pinned |
      | phoenix | 1.7.11 |
      | ecto    | 3.11.1 |

  @id:ecosystem-support.web-and-scripting.008 @rule:hex.manifests.mix-exs-range-floor @verified @source:src/ecosystems/hex.ts#parseMixExs @test:src/ecosystems/phase3.test.ts#reads mix.exs deps and skips git/path deps @questionable
  Scenario Outline: A mix.exs dependency is measured from the lowest version its requirement allows
    Given a mix.exs declaring <package> with requirement <requirement>
    And a mix.exs dependency taken from a local path or a GitHub repository
    When the operator checks the mix.exs
    Then the report lists <package> at version <current>, marked as not resolved
    And the path and GitHub dependencies are not listed

    Examples:
      | package | requirement | current |
      | phoenix | ~> 1.7.0    | 1.7.0   |
      | ecto    | >= 3.0.0    | 3.0.0   |
      | plug    | ~> 1.15     | 1.15    |

  @id:ecosystem-support.web-and-scripting.009 @rule:hex.registry.release-history @inferred @source:src/ecosystems/hex.ts#hex @questionable
  Scenario Outline: Hex release history comes from hex.pm with each release's publish date
    Given hex.pm lists releases <versions> for phoenix, each with its publish time
    When the operator checks a manifest that depends on phoenix
    Then the drift for phoenix is measured against the releases <versions> and their publish dates

    Examples:
      | versions               |
      | 1.7.10, 1.7.11, 1.7.14 |

  @id:ecosystem-support.web-and-scripting.010 @rule:hex.metadata.repo-owners-funding @inferred @source:src/ecosystems/hex.ts#hex @questionable
  Scenario Outline: Deep checks read a Hex package's repository, owner count and funding from its hex.pm links
    Given hex.pm records phoenix with links <links> and <owners> owners
    When the operator runs a deep check on a manifest that depends on phoenix
    Then the repository is <repo>
    And the maintainer count is <maintainers>
    And funding is <funding>

    Examples:
      | links                                                                            | owners        | repo                               | maintainers | funding |
      | GitHub: https://github.com/example/phoenix, Sponsor: https://example.com/sponsor | 3             | https://github.com/example/phoenix | 3           | present |
      | Website: https://example.com                                                     | no owner list | none                               | unknown     | absent  |
