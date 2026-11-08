@domain:reporting @area:pull-request-summary @from:scripts/action-report
Feature: Summarising a depwatch check in a GitHub Actions run
  Gives teams running the depwatch GitHub Action a job summary, pull request comment and step outputs that show the verdict, the drift change and the dependencies worth acting on, without opening the JSON report.

  Background:
    Given a repository whose workflow runs the depwatch action on a manifest
    And depwatch has measured the manifest and produced its report

  @id:reporting.pull-request-summary.001 @rule:reporting.pr-summary.verdict-follows-check-exit @inferred @source:scripts/action-report.mjs#summary
  Scenario Outline: The summary headline states whether thresholds were met, as the check decided
    Given the manifest totals 3.456 libyears across 12 dependencies
    And the check finished with exit code <exit>
    When the action summarises the run
    Then the summary headline reads "**3.46 libyears** across 12 dependencies — <headline>."
    And the passed step output is "<passed>"

    Examples:
      | exit | headline           | passed |
      | 0    | thresholds met     | true   |
      | 1    | threshold breached | false  |

  @id:reporting.pull-request-summary.002 @rule:reporting.pr-summary.step-outputs-contract @inferred @source:scripts/action-report.mjs#setOutputs
  Scenario: Later workflow steps can read the run's totals and quadrant counts as step outputs
    Given the manifest "package.json" in the npm ecosystem totals 4.2 libyears
    And it has 2 replace, 1 upgrade, 0 watch and 5 healthy dependencies, plus 1 with no registry data
    When the action summarises the run
    Then the step outputs include libyears "4.20", deps "9", ecosystem "npm" and file "package.json"
    And the step outputs include replace "2", upgrade "1", watch "0", healthy "5" and degraded "1"
    And the step outputs include report set to the JSON report path
    And a newline inside the file or ecosystem value is written as a space so it stays one output

  @id:reporting.pull-request-summary.003 @rule:reporting.pr-summary.drift-delta-against-base @inferred @source:scripts/action-report.mjs#deltaLines
  Scenario Outline: The summary shows how drift changed against the base branch only when the base was measured
    Given the manifest totals <head> libyears
    And the base branch measurement is <base>
    When the action summarises the run
    Then the summary shows the line "<line>"
    And the delta step output is "<delta>"

    Examples:
      | head  | base        | line                                                         | delta |
      | 5.50  | 4.25        | ⬆️ **+1.25 libyears** against the base branch (4.25 → 5.50). | +1.25 |
      | 3.00  | 4.25        | ⬇️ **-1.25 libyears** against the base branch (4.25 → 3.00). | -1.25 |
      | 4.254 | 4.25        | ➡️ No change against the base branch (4.25 libyears).        | 0.00  |
      | 4.25  | unavailable | (no base-branch line)                                        |       |

  @id:reporting.pull-request-summary.004 @rule:reporting.pr-summary.breached-gates-listed @inferred @source:scripts/action-report.mjs#summary
  Scenario: Each breached gate is listed in the summary in the check's own words
    Given the check reported "depwatch: total drift 12.40 libyears exceeds --max-libyears 10"
    When the action summarises the run
    Then the summary contains a Gate table
    And the table has the row "| ❌ | total drift 12.40 libyears exceeds --max-libyears 10 |"
    And when the check reported nothing, the summary has no Gate table

  @id:reporting.pull-request-summary.005 @rule:reporting.pr-summary.notable-dependencies-worst-first @inferred @source:scripts/action-report.mjs#notableLines
  Scenario Outline: Only dependencies worth acting on are listed, worst first, up to thirty
    Given the manifest has <notable> dependencies that are not healthy or had no registry data
    And it also has 200 healthy dependencies
    When the action summarises the run
    Then the dependency table lists replace before upgrade before watch, and within a quadrant the larger drift first, then by name
    And healthy dependencies are not listed
    And the table shows <shown> rows
    And <footer>

    Examples:
      | notable | shown | footer                                                        |
      | 0       | 0     | no dependency table is shown                                  |
      | 12      | 12    | no overflow note is shown                                     |
      | 45      | 30    | the note "…and 15 more in the JSON report." follows the table |

  @id:reporting.pull-request-summary.006 @rule:reporting.pr-summary.unscored-dependencies-reported @inferred @source:scripts/action-report.mjs#summary
  Scenario: Dependencies with no registry data are shown as unscored, not as healthy
    Given 2 dependencies had no registry data
    When the action summarises the run
    Then each of them is listed with a ⚪ icon and "—" for drift and viability
    And they are left out of the replace, upgrade, watch and healthy counts
    And the summary says "2 dependencies had no registry data and were not scored."

  @id:reporting.pull-request-summary.007 @rule:reporting.pr-summary.range-versions-upper-bound @inferred @source:scripts/action-report.mjs#summary @questionable
  Scenario: The summary warns that drift is an upper bound when versions came from ranges
    Given 3 of 10 dependency versions were taken from a range rather than a lock file
    When the action summarises the run
    Then the summary says "Upper bound: 3 of 10 versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower."
    And when every version was resolved, no upper-bound note is shown

  @id:reporting.pull-request-summary.008 @rule:reporting.pr-summary.manifest-text-cannot-break-layout @inferred @source:scripts/action-report.mjs#depRow
  Scenario: Names taken from the manifest cannot break the summary table
    Given the manifest declares a dependency named "evil|`pkg`" at version "1.0|2"
    When the action summarises the run
    Then its row shows the name as "evil  pkg " and the version as "1.0 2"
    And the dependency table keeps seven columns on every row
