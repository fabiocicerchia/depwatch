@domain:reporting @area:terminal-output @from:src/render-text
Feature: Reading a dependency report in the terminal
  Shows operators running `depwatch check` or `depwatch trend` without --json a plain-text report: every dependency on both axes, the totals, and notes on anything the numbers leave out.

  Background:
    Given the operator runs depwatch without --json

  @id:reporting.terminal-output.001 @rule:reporting.terminal.worst-first-table @inferred @source:src/render-text.ts#table
  Scenario: Dependencies are listed worst first in a column table
    Given a manifest whose dependencies are left-pad (replace, 4.10 libyears), lodash (upgrade, 2.30 libyears), chalk (upgrade, 3.00 libyears) and zod (healthy, 0.10 libyears)
    When the operator checks the manifest
    Then the table header names the columns dep, current, eco, latest, drift, pulse, viability and quadrant, each padded to its widest cell, with a ruled line under it
    And the rows appear in the order left-pad, chalk, lodash, zod
    And drift, pulse and viability are shown with two decimals
    And no line ends in trailing spaces

  @id:reporting.terminal-output.002 @rule:reporting.terminal.summary-footer @inferred @source:src/render-text.ts#table
  Scenario: The report ends with total drift, quadrant counts and the thresholds in force
    Given a package.json with 4 scored dependencies totalling 0.12 libyears, all healthy
    And the default thresholds of 1 libyear and 0.5 viability
    When the operator checks the manifest
    Then after a blank line, the output reads "total drift: 0.12 libyears across 4 deps  (npm, package.json)"
    And the next line reads "quadrants: replace 0  upgrade 0  watch 0  healthy 4"
    And the next line reads "thresholds: behind > 1 libyears, fading < 0.5 viability"

  @id:reporting.terminal-output.003 @rule:reporting.terminal.unscored-deps-flagged @inferred @source:src/render-text.ts#table
  Scenario: Dependencies with no registry data are flagged as not scored
    Given a manifest where 2 dependencies could not be found in their registry
    When the operator checks the manifest
    Then those rows show "—" for drift and viability and "no data" as the quadrant
    And they are left out of the quadrant counts
    And the footer adds "2 dep(s) had no registry data and were not scored"

  @id:reporting.terminal-output.004 @rule:reporting.terminal.pulse-only-deps-flagged @inferred @source:src/render-text.ts#table @questionable
  Scenario: Dependencies without a comparable version series are flagged as pulse-only
    Given a Dockerfile whose 3 base images have release dates but no orderable version series
    When the operator checks the manifest
    Then those rows show "—" for drift and "pulse-only" as the quadrant
    And the footer adds "3 dep(s) scored on pulse and viability only — no comparable version series (drift shown as —)"
    And the quadrants line counts those 3 under healthy, whatever their viability

  @id:reporting.terminal-output.005 @rule:reporting.terminal.range-derived-upper-bound @inferred @source:src/render-text.ts#table @questionable
  Scenario: Drift measured from version ranges is labelled an upper bound
    Given a package.json of 10 dependencies with no lock file beside it, 8 of them found in the registry and 2 not
    When the operator checks the manifest
    Then the footer adds "upper bound: 8 of 10 versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower"

  @id:reporting.terminal-output.006 @rule:reporting.terminal.trend-lines @inferred @source:src/render-text.ts#trendTable
  Scenario Outline: A drift trend prints one line per sampled commit and the net change
    Given a manifest sampled at <count> commits whose total drift went from <first> to <last> libyears
    When the operator runs the drift trend
    Then each sampled commit gets one line with its date, commit, total libyears, dependency count and replace count
    And the closing line reads "<summary>"

    Examples:
      | count | first | last | summary                               |
      | 2     | 1.00  | 4.50 | +3.50 libyears over 2 sampled commits |
      | 2     | 4.50  | 1.00 | -3.50 libyears over 2 sampled commits |
      | 3     | 2.00  | 2.00 | +0.00 libyears over 3 sampled commits |
      | 1     | 2.00  | 2.00 | (no closing line)                     |
