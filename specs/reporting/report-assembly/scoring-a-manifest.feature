@domain:reporting @area:report-assembly @from:src/report
Feature: Scoring a manifest on drift and viability
  Gives developers and CI operators one report per manifest that places every dependency on the drift-versus-viability axes, so they know whether to upgrade, watch or replace it.

  Background:
    Given the default thresholds: stale above 1 libyear, risky below 0.5 viability

  @id:reporting.report-assembly.001 @rule:reporting.quadrant.drift-and-viability-placement @verified @source:src/report.ts#quadrant @test:src/report.test.ts#separates the four cases
  Scenario Outline: A dependency's quadrant follows from its drift and its viability
    Given a dependency <drift> libyears behind its latest release
    And its viability score is <viability>
    When the developer checks the manifest
    Then the dependency is placed in the "<quadrant>" quadrant

    Examples:
      | drift | viability | quadrant |
      | 0.20  | 0.90      | healthy  |
      | 3.00  | 0.90      | upgrade  |
      | 0.20  | 0.10      | watch    |
      | 3.00  | 0.10      | replace  |
      | 1.00  | 0.50      | healthy  |

  @id:reporting.report-assembly.002 @rule:reporting.unknowns.unreachable-dependency-reported-as-no-data @verified @source:src/report.ts#analyseDep @test:src/report.test.ts#degrades a dep the registry could not answer for @questionable
  Scenario Outline: A dependency with no registry data is reported as unknown, not as stale or abandoned
    Given a dependency whose <situation>
    When the developer checks the manifest
    Then the dependency is listed with the reason "<reason>"
    And its drift, latest and viability columns show "—" and its quadrant shows "no data"
    And it adds nothing to the total libyears
    And the rest of the manifest is still scored

    Examples:
      | situation                         | reason                              |
      | registry does not know it         | not found in registry               |
      | registry lists no versions for it | registry returned no versions       |
      | ecosystem "cobol" is not supported | unsupported ecosystem "cobol"       |

  @id:reporting.report-assembly.003 @rule:reporting.unknowns.pulse-only-ecosystem-drift-unscored @inferred @source:src/report.ts#analyseDep @questionable
  Scenario: Dependencies from ecosystems without an orderable version series get pulse and viability but no drift
    Given a Docker base image pinned to a tag released 2.00 years ago
    When the developer checks the manifest
    Then its drift column shows "—" and latest shows "—"
    And its pulse column shows "2.00"
    And its viability is scored
    And its quadrant shows "pulse-only"

  @id:reporting.report-assembly.004 @rule:reporting.totals.total-libyears-and-worst-five @verified @source:src/report.ts#analyse @test:src/report.test.ts#scores drift and viability from the injected cache without fetching
  Scenario: The report totals drift across the manifest and names the five deepest in debt
    Given a manifest of seven dependencies with drift 5.00, 4.00, 3.00, 2.00, 1.50, 0.50 and 0.00 libyears
    When the developer checks the manifest
    Then the total drift is 16.00 libyears
    And the worst dependencies are the five at 5.00, 4.00, 3.00, 2.00 and 1.50 libyears
    And the report names the manifest file, its ecosystem and when it was generated

  @id:reporting.report-assembly.005 @rule:reporting.ordering.worst-first @inferred @source:src/report.ts#compareDeps
  Scenario: Dependencies are listed worst first
    Given dependencies "alpha" healthy at 0.10 libyears, "beta" replace at 2.00, "gamma" upgrade at 4.00 and "delta" upgrade at 4.00
    When the developer views the report
    Then the order is "beta", "delta", "gamma", "alpha"

  @id:reporting.report-assembly.006 @rule:reporting.history.as-of-hides-later-releases @verified @source:src/report.ts#versionsAsOf @test:src/report.test.ts#hides releases published after asOf
  Scenario: A report as of a past date ignores releases published after it
    Given a dependency pinned to 1.0.0 released 2020-01-01
    And version 2.0.0 was released 2025-01-01
    When the developer scores the manifest as of 2023-01-01
    Then its latest version is 1.0.0
    And its drift is 0.00 libyears

  @id:reporting.report-assembly.007 @rule:reporting.ecosystems.component-ecosystem-wins @inferred @source:src/report.ts#analyseDep
  Scenario: Each component of a mixed-ecosystem SBOM is scored against its own registry
    Given an SBOM listing an npm component and a PyPI component
    When the developer checks the SBOM
    Then the npm component is scored from the npm registry and shows eco "npm"
    And the PyPI component is scored from PyPI and shows eco "pep440"

  @id:reporting.report-assembly.008 @rule:reporting.scan.cancelled-scan-stops @verified @source:src/report.ts#ScanAborted @test:src/report.test.ts#stops taking new work once the signal aborts
  Scenario: A cancelled scan stops and reports that it was cancelled
    Given a manifest of 20 dependencies being scanned
    When the developer cancels the scan partway through
    Then the scan ends with "scan cancelled"
    And dependencies not yet started are never looked up
