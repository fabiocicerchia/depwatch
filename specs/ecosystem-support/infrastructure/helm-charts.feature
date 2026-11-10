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
    Given a <file> listing chart "cache" <repository> and version "<version>"
    When the operator checks the <file>
    Then "cache" does not appear in the report

    Examples:
      | file       | repository                                        | version |
      | Chart.lock | with repository oci://registry.example.com/charts | 1.0.0   |
      | Chart.yaml | with no repository field                          | 1.0.0   |
      | Chart.yaml | with repository https://charts.example.com        | 17.x    |

  @id:ecosystem-support.infrastructure.019 @rule:ecosystems.helm.chart-identity-is-repository-plus-name @inferred @source:src/ecosystems/helm.ts#parseDeps
  Scenario: A chart is identified by its repository and its name together
    Given a Chart.lock with chart "redis" from https://charts.example.com/stable/
    And chart "redis" from https://mirror.example.org/charts
    When the operator checks the Chart.lock
    Then the report lists "https://charts.example.com/stable#redis"
    And the report lists "https://mirror.example.org/charts#redis" as a separate dependency

  @id:ecosystem-support.infrastructure.020 @rule:ecosystems.helm.history-from-repository-index @inferred @source:src/ecosystems/helm.ts#helm
  Scenario: A chart's release history comes from its own repository's index
    Given the repository https://charts.example.com publishes an index listing "redis" 18.0.0 created 2024-03-01 and 17.11.3 created 2023-06-01
    When the operator checks a Chart.lock pinning "https://charts.example.com#redis" at 17.11.3
    Then "redis" is reported with latest version 18.0.0
    And its drift is measured between the 2023-06-01 and 2024-03-01 release dates
