@domain:in-editor-findings @area:hover-explanations @from:src/explain
Feature: Explaining dependency findings in plain language
  Serves developers reading a squiggle, a Problems entry or a hover, so each finding says in words why the dependency landed in its quadrant and what to do, rather than showing bare scores.

  Background:
    Given a scanned manifest with drift threshold 1 libyear and viability threshold 0.5

  @id:vscode.in-editor-findings.hover-explanations.005 @rule:findings.explanations.problem-message-states-quadrant-and-numbers @verified @source:extensions/vscode/src/explain.ts#summarise @test:extensions/vscode/src/report-view.test.ts#names the quadrant, both numbers and the upgrade
  Scenario: A finding's message names its quadrant, both scores, the upgrade path and the thresholds
    Given dependency "left-pad" is on 1.0.0, the latest is 2.0.0
    And it is 2.5 libyears behind with viability 0.3, in the Replace quadrant
    When the developer reads the finding in the Problems panel
    Then the message reads "left-pad: Replace — 2.50 libyears behind, viability 0.30, 1.0.0 → 2.0.0. behind and unmaintained — the upgrade you need may never be written. Behind means over 1 libyears; fading means viability under 0.5."

  @id:vscode.in-editor-findings.hover-explanations.006 @rule:findings.explanations.unscored-dependency-not-scored @verified @source:extensions/vscode/src/explain.ts#reasons @test:extensions/vscode/src/report-view.test.ts#says a degraded dep was not scored rather than scoring it @test:extensions/vscode/src/report-view.test.ts#says only that the registry did not answer, for a degraded dep @questionable
  Scenario: A dependency the registry did not answer for is reported as not scored, never given a verdict
    Given the registry answered "registry HTTP 503" for dependency "left-pad"
    When the developer reads its Problems entry and hovers the dependency
    Then the Problems message reads "left-pad: no registry data (registry HTTP 503) — not scored" and names no quadrant
    And the hover heading reads "left-pad — not scored" with a "no data" badge
    And the only fact listed is "the registry did not answer for this package (registry HTTP 503)"

  @id:vscode.in-editor-findings.hover-explanations.007 @rule:findings.explanations.facts-worst-first @verified @source:extensions/vscode/src/explain.ts#tooltip @test:extensions/vscode/src/report-view.test.ts#turns the signals into facts, worst first
  Scenario: The hover lists the facts behind a dependency's scores, archived status first
    Given dependency "left-pad" 1.0.0 shipped 2021-01-01 and 2.0.0 shipped 2023-07-01, 2.5 libyears behind
    And its last release was 2.5 years ago, its repository is archived, last commit 900 days ago, releases about every 400 days, it has a funding channel
    When the developer hovers the dependency
    Then the first fact is "the repository is archived — the maintainer has said the project is over"
    And the next fact is "2.50 libyears behind: 1.0.0 shipped 2021-01-01, 2.0.0 shipped 2023-07-01"
    And the facts include "last release 2.5 years ago", "last commit 2.5 years ago", "ships about every 1.1 years" and "has a funding channel"
    And the hover ends with "Behind means over 1 libyears; fading means viability under 0.5." and a link to the package on its registry

  @id:vscode.in-editor-findings.hover-explanations.008 @rule:findings.explanations.bus-factor-wording @verified @source:extensions/vscode/src/explain.ts#bus @test:extensions/vscode/src/report-view.test.ts#turns the signals into facts, worst first
  Scenario Outline: The hover states how many people maintain a dependency, warning when it is only one
    Given a deep scan found <maintainers> maintainers for dependency "left-pad"
    When the developer hovers the dependency
    Then the facts include "<fact>"

    Examples:
      | maintainers | fact                                   |
      | 0           | no maintainers listed                  |
      | 1           | one maintainer — one person is one bus |
      | 4           | 4 maintainers                          |

  @id:vscode.in-editor-findings.hover-explanations.009 @rule:findings.explanations.range-version-is-upper-bound @verified @source:extensions/vscode/src/explain.ts#REASONS @test:extensions/vscode/src/report-view.test.ts#explains that a range-derived version is an upper bound
  Scenario: Drift read from a version range is flagged as an upper bound
    Given dependency "left-pad" has no lock file entry, so its version was read from the manifest's range
    When the developer hovers the dependency
    Then the facts include "version read from a range, not a lock file — the real drift is this or lower"

  @id:vscode.in-editor-findings.hover-explanations.010 @rule:findings.explanations.suggest-deep-scan @verified @source:extensions/vscode/src/explain.ts#isCheapTierOnly @test:extensions/vscode/src/report-view.test.ts#says when only the release timeline was available
  Scenario: A dependency scored from releases alone suggests running a deep scan
    Given dependency "left-pad" was scored without maintainer, last-commit or archived information
    When the developer hovers the dependency
    Then the facts include "scored from the release timeline only — run a deep scan for maintainers, archived status and last commit"

  @id:vscode.in-editor-findings.hover-explanations.011 @rule:findings.explanations.registry-link @verified @source:extensions/vscode/src/explain.ts#registryUrl @test:extensions/vscode/src/report-view.test.ts#links to the registry the dep came from
  Scenario Outline: Findings link to the package's page on its own registry
    Given dependency "<name>" comes from the <ecosystem> ecosystem
    When the developer hovers the dependency
    Then the hover links to "<link>"
    And the Problems entry's code links to the same page

    Examples:
      | ecosystem | name              | link                                           |
      | npm       | left-pad          | https://www.npmjs.com/package/left-pad         |
      | pep440    | requests          | https://pypi.org/project/requests/             |
      | cargo     | serde             | https://crates.io/crates/serde                 |
      | composer  | monolog/monolog   | https://packagist.org/packages/monolog/monolog |
      | rubygems  | rails             | https://rubygems.org/gems/rails                |
      | go        | golang.org/x/text | no link                                        |

  @id:vscode.in-editor-findings.hover-explanations.012 @rule:findings.explanations.release-age-phrasing @inferred @source:extensions/vscode/src/explain.ts#years
  Scenario Outline: Time since the last release is phrased in months or years a person can read
    Given the last release of dependency "left-pad" was <age> years ago
    When the developer hovers the dependency
    Then the facts include "last release <phrase> ago"

    Examples:
      | age  | phrase            |
      | 0.05 | less than a month |
      | 0.5  | 6 months          |
      | 3.4  | 3.4 years         |
