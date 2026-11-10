@domain:reports @area:report-panel @from:src/html
Feature: Reading the depwatch report
  Gives a developer one themed page per workspace with the drift and viability totals, a chart and table per manifest, and the CI gate verdict, so they can see where they stand without leaving the editor.

  Background:
    Given a workspace is open in the editor

  @id:vscode.reports.report-panel.003 @rule:reports.page.empty-state-points-to-scan @inferred @source:extensions/vscode/src/html.ts#reportHtml
  Scenario: An empty report tells the user how to scan
    Given no manifest has been scanned and none failed
    When the developer opens the depwatch report
    Then the page reads "Nothing scanned yet. Run depwatch: Scan the workspace from the command palette."
    And no stats, chart or table are shown

  @id:vscode.reports.report-panel.004 @rule:reports.page.workspace-totals @verified @source:extensions/vscode/src/html.ts#reportHtml @test:extensions/vscode/src/report-view.test.ts#renders the totals, the chart and a row per dep
  Scenario Outline: The report opens with workspace-wide totals
    Given manifest "<first>" has <deps_a> dependencies totalling <ly_a> libyears
    And manifest "<second>" has <deps_b> dependencies totalling <ly_b> libyears
    When the developer opens the depwatch report
    Then the stats show "<total_ly> libyears of drift"
    And the stats show "<total_deps> dependencies" and "2 manifests"
    And the quadrant stat shows how many dependencies fall in each of healthy, upgrade, watch and replace

    Examples:
      | first        | deps_a | ly_a | second           | deps_b | ly_b | total_ly | total_deps |
      | package.json | 3      | 2.50 | api/package.json | 2      | 1.25 | 3.75     | 5          |

  @id:vscode.reports.report-panel.005 @rule:reports.page.package-names-never-markup @verified @source:extensions/vscode/src/html.ts#row @test:extensions/vscode/src/report-view.test.ts#escapes anything that came from a package name
  Scenario: Package names from a registry are shown as text, never run as markup
    Given a manifest declares a dependency named "<script>alert(1)</script>"
    When the developer opens the depwatch report
    Then the dependency's name is displayed literally as text
    And no script from the name runs in the report

  @id:vscode.reports.report-panel.006 @rule:reports.page.gate-verdict @verified @source:extensions/vscode/src/html.ts#gateBanner @test:extensions/vscode/src/report-view.test.ts#reports gate failures when gates are configured @test:extensions/vscode/src/report-view.test.ts#says nothing about gates when none are set
  Scenario Outline: The report shows the CI gate verdict only when gates are configured
    Given CI gates are <gates_state>
    When the developer opens the depwatch report
    Then the gate banner shows <banner>

    Examples:
      | gates_state                                 | banner                                                                                         |
      | not configured                              | nothing                                                                                        |
      | configured and all passing                  | "Gates pass — the same checks depwatch check --ci runs."                                       |
      | configured with one failing on package.json | "1 gate(s) failing" listing "package.json: total drift 2.50 libyears exceeds --max-libyears 1" |

  @id:vscode.reports.report-panel.007 @rule:reports.page.unscanned-manifests-listed @verified @source:extensions/vscode/src/html.ts#reportHtml @test:extensions/vscode/src/report-view.test.ts#lists manifests that could not be scanned
  Scenario: Manifests that could not be scanned are listed with the reason
    Given manifest "api/package.json" failed to scan with "no dependencies found"
    When the developer opens the depwatch report
    Then a "Not scanned" section lists "api/package.json — no dependencies found"

  @id:vscode.reports.report-panel.008 @rule:reports.page.drift-caveats-stated @inferred @source:extensions/vscode/src/html.ts#manifestSection
  Scenario Outline: A manifest says when its drift is incomplete or an upper bound
    Given manifest "package.json" has 4 dependencies
    And <count> of them <condition>
    When the developer opens the depwatch report
    Then the manifest section notes "<note>"

    Examples:
      | count | condition                                        | note                                                                                                                           |
      | 1     | had no registry answer                           | 1 dep(s) had no registry data and were not scored.                                                                             |
      | 2     | have only a version range and no lock file entry | Upper bound: 2 of 4 versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower. |

  @id:vscode.reports.report-panel.010 @rule:reports.page.sortable-columns @inferred @source:extensions/vscode/src/html.ts#CLICK_SCRIPT @questionable
  Scenario Outline: Clicking a column header sorts the table, descending first
    Given the report in the editor lists dependencies with drift 0.50, 2.50 and 1.25
    When the developer clicks the "<column>" header <times>
    Then the rows are ordered <order>

    Examples:
      | column | times | order                               |
      | drift  | once  | highest number first                |
      | drift  | twice | lowest number first                 |
      | dep    | once  | names in reverse alphabetical order |
