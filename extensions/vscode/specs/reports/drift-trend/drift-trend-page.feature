@domain:reports @area:drift-trend @from:src/html
Feature: Seeing a manifest's drift over its history
  Shows a developer, in its own tab, how one manifest's drift moved across the commits that touched it, so they know whether they are falling behind or catching up.

  @id:vscode.reports.drift-trend.004 @rule:reports.trend.row-per-sampled-commit @verified @source:extensions/vscode/src/html.ts#trendHtml @test:extensions/vscode/src/report-view.test.ts#lists a row per sampled commit and says which way it went
  Scenario: The trend lists each sampled commit with its drift
    Given commit "aaaaaaaa" on 2024-01-01 had 1.00 libyears across 4 deps with 0 to replace
    And commit "bbbbbbbb" on 2025-01-01 had 3.00 libyears across 5 deps with 2 to replace
    When the developer opens the drift trend for "package.json"
    Then the tab reads "Drift over the history of package.json."
    And a table shows date, commit, libyears, deps and replace for each of the two commits

  @id:vscode.reports.drift-trend.005 @rule:reports.trend.direction-summary @verified @source:extensions/vscode/src/html.ts#trendHtml @test:extensions/vscode/src/report-view.test.ts#lists a row per sampled commit and says which way it went @questionable
  Scenario Outline: The trend says whether the manifest is drifting further behind or catching up
    Given the first sampled commit had <first> libyears and the last of <count> had <last>
    When the developer opens the drift trend for "package.json"
    Then the tab reads "<summary>"

    Examples:
      | first | last | count | summary                                                          |
      | 1.00  | 3.00 | 2     | +2.00 libyears over 2 sampled commits — drifting further behind. |
      | 3.00  | 1.00 | 2     | -2.00 libyears over 2 sampled commits — catching up.             |
      | 2.00  | 2.00 | 3     | +0.00 libyears over 3 sampled commits — catching up.             |

  @id:vscode.reports.drift-trend.006 @rule:reports.trend.no-history @verified @source:extensions/vscode/src/html.ts#trendHtml @test:extensions/vscode/src/report-view.test.ts#says so when there is no history
  Scenario: A manifest with no history says so
    Given no commit has touched "package.json"
    When the developer opens the drift trend for "package.json"
    Then the tab reads "No commits touched this file."
    And no table is shown

  @id:vscode.reports.drift-trend.007 @rule:reports.trend.ignores-editor-theme @inferred @source:extensions/vscode/src/panel.ts#showTrend @questionable
  Scenario: The trend tab uses the depwatch look rather than the editor theme
    Given the editor uses a light theme
    When the developer opens the drift trend for "package.json"
    Then the tab is coloured with the depwatch palette, following the system light or dark preference instead of the editor theme
