@domain:ecosystem-support @area:infrastructure @from:ecosystems/helm
Feature: Scoring Helm chart dependencies
  Lets platform teams see how far behind, and how viable, the subcharts their Helm chart depends on are, using each chart repository's own index.

  Background:
    Given a Helm chart whose dependencies come from HTTP chart repositories

  @id:ecosystem-support.infrastructure.016 @rule:ecosystems.helm.lock-file-pins-exact-versions @verified @source:src/ecosystems/helm.ts#helm @test:src/ecosystems/phase3.test.ts#reads Chart.lock deps with the repo-qualified name
  Scenario: A Chart.lock is read as exact, resolved chart versions
    Given a Chart.lock pinning "redis" at 17.11.3 from https://charts.bitnami.com/bitnami
    When the operator checks the Chart.lock
    Then the manifest is recognised as Helm
    And the dependency "https://charts.bitnami.com/bitnami#redis" is reported at version 17.11.3
    And the version is marked resolved

  @id:ecosystem-support.infrastructure.017 @rule:ecosystems.helm.chart-yaml-uses-constraint-floor @inferred @source:src/ecosystems/helm.ts#parseDeps
  Scenario Outline: A Chart.yaml constraint is scored at its lowest allowed version
    Given a Chart.yaml requiring chart "redis" with version constraint "<constraint>"
    When the operator checks the Chart.yaml
    Then "redis" is reported at version <current>
    And the version is marked unresolved

    Examples:
      | constraint     | current |
      | ~17.11.0       | 17.11.0 |
      | >=1.2.0 <2.0.0 | 1.2.0   |
      | ^2.4           | 2.4     |

  @id:ecosystem-support.infrastructure.018 @rule:ecosystems.helm.unscorable-dependencies-left-out @verified @source:src/ecosystems/helm.ts#parseDeps @test:src/ecosystems/phase3.test.ts#reads Chart.lock deps with the repo-qualified name @questionable
  Scenario Outline: Chart dependencies that cannot be scored are left out of the report
    Given a <file> listing chart "cache" with repository "<repository>" and version "<version>"
    When the operator checks the <file>
    Then "cache" does not appear in the report

    Examples:
      | file       | repository                        | version |
      | Chart.lock | oci://registry.example.com/charts | 1.0.0   |
      | Chart.yaml |                                   | 1.0.0   |
      | Chart.yaml | https://charts.example.com        | 17.x    |

  @id:ecosystem-support.infrastructure.019 @rule:ecosystems.helm.chart-identity-is-repository-plus-name @inferred @source:src/ecosystems/helm.ts#parseDeps
  Scenario: A chart is identified by its repository and its name together
    Given a Chart.lock with chart "redis" from https://charts.example.com/stable/
    And and chart "redis" from https://mirror.example.org/charts
    When the operator checks the Chart.lock
    Then the report lists "https://charts.example.com/stable#redis"
    And and the report lists "https://mirror.example.org/charts#redis" as a separate dependency

  @id:ecosystem-support.infrastructure.020 @rule:ecosystems.helm.history-from-repository-index @inferred @source:src/ecosystems/helm.ts#helm
  Scenario: A chart's release history comes from its own repository's index
    Given the repository https://charts.example.com publishes an index listing "redis" 18.0.0 created 2024-03-01 and 17.11.3 created 2023-06-01
    When the operator checks a Chart.lock pinning "https://charts.example.com#redis" at 17.11.3
    Then "redis" is reported with latest version 18.0.0
    And its drift is measured between the 2023-06-01 and 2024-03-01 release dates

  @id:ecosystem-support.infrastructure.021 @rule:ecosystems.helm.deprecated-chart-is-end-of-life @inferred @source:src/ecosystems/helm.ts#helm @questionable
  Scenario: A deprecated chart is reported as end-of-life in the deep check
    Given the repository index marks a version of "https://charts.example.com#legacy" as deprecated
    And and the chart lists no GitHub source
    When the operator runs a deep check of a Chart.lock using that chart
    Then "legacy" is reported as archived

  @id:ecosystem-support.infrastructure.022 @rule:ecosystems.helm.deprecation-overridden-by-github-source @inferred @source:src/signals.ts#fetchDeepMeta @questionable
  Scenario: A deprecated chart whose source is an active GitHub repository is not reported as end-of-life
    Given the repository index marks "https://charts.example.com#legacy" as deprecated
    And and the chart's newest entry lists source https://github.com/example/legacy, which is not archived
    When the operator runs a deep check of a Chart.lock using that chart
    Then "legacy" is not reported as archived
    And its last commit date is taken from the GitHub repository
