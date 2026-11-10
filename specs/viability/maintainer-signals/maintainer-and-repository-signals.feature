@domain:viability @area:maintainer-signals @from:src/signals
Feature: Gathering maintainer and repository signals on request
  Lets a user who opts in with --deep see bus factor, funding, archived status and last commit for each dependency, without failing the report when a registry or GitHub cannot answer.

  Background:
    Given a manifest that declares the dependency

  @id:viability.maintainer-signals.001 @rule:viability.maintainer-signals.registry-maintainers-and-funding @inferred @source:src/signals.ts#fetchDeepMeta
  Scenario: With --deep, the registry's maintainer count and funding are reported
    Given the dependency's registry lists 1 maintainer and a funding link
    When the user checks the manifest with --deep
    Then the dependency's maintainer count is 1
    And it is reported as funded

  @id:viability.maintainer-signals.002 @rule:viability.maintainer-signals.github-archived-and-last-commit @inferred @source:src/signals.ts#fetchDeepMeta
  Scenario Outline: With --deep, a GitHub repository's archived status and last commit are reported
    Given the dependency's registry points to its source at <repository>
    And that repository is <state> and was last pushed to 45 days before the moment being scored
    When the user checks the manifest with --deep
    Then the dependency is <archived> archived
    And its last commit age is 45 days

    Examples:
      | repository                                      | state    | archived   |
      | git+ssh://git@github.com/acme/widget.git        | archived | marked     |
      | https://github.com/acme/widget                  | active   | not marked |
      | https://github.com/acme/widget/tree/main#readme | active   | not marked |

  @id:viability.maintainer-signals.003 @rule:viability.maintainer-signals.registry-end-of-life-is-archived @inferred @source:src/signals.ts#fetchDeepMeta @questionable
  Scenario Outline: With --deep, a chart its registry marks deprecated is reported archived unless GitHub says otherwise
    Given a Helm chart dependency with a deprecated version in its repository index
    And the chart's source is <source>
    When the user checks the manifest with --deep
    Then the dependency is <archived> archived

    Examples:
      | source                                     | archived   |
      | not a GitHub repository                    | marked     |
      | an active, unarchived GitHub repository    | not marked |
      | a GitHub repository that cannot be reached | marked     |

  @id:viability.maintainer-signals.004 @rule:viability.maintainer-signals.unreachable-source-degrades-not-fails @inferred @source:src/signals.ts#fetchDeepMeta
  Scenario Outline: With --deep, a source that cannot answer leaves its signals unknown instead of failing the report
    Given <situation>
    When the user checks the manifest with --deep
    Then the report is produced and the dependency is scored
    And <unknown> are reported unknown
    And its release signals are still reported

    Examples:
      | situation                                                                        | unknown                              |
      | GitHub rate-limits or refuses the repository lookup                              | last commit age                      |
      | the repository URL is not on GitHub, e.g. https://gitlab.example.com/acme/widget | last commit age                      |
      | the registry's metadata request fails                                            | maintainer count and last commit age |
      | the ecosystem has no deep registry metadata at all                               | maintainer count and last commit age |
