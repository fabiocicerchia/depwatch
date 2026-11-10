@domain:reports @area:report-panel @from:src/panel
Feature: Viewing the dependency report in the editor
  Gives developers a themed report tab of drift × viability per manifest, with gate results, that stays current while scans run and lets them jump straight to a dependency.

  Background:
    Given the workspace has been scanned and results exist for one or more manifests

  @id:vscode.reports.report-panel.011 @rule:reports.report-panel.single-report-tab @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario: Opening the report again brings back the same tab
    Given the depwatch report tab is already open behind other editors
    When the developer opens the report
    Then the existing "depwatch report" tab comes to the front in the column it was already in
    And no second report tab is opened
    And the tab shows the current results

  @id:vscode.reports.report-panel.012 @rule:reports.report-panel.live-updates-while-open @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario: An open report follows a running scan without rebuilding on every manifest
    Given the report tab is open and visible
    And a workspace scan is publishing results manifest by manifest
    When new scan results arrive
    Then the first new results appear in the report at once
    And further results arriving within the next second are shown together in one update about a second later
    And a report tab that is hidden at the time catches up when it is shown again

  @id:vscode.reports.report-panel.014 @rule:reports.report-panel.gates-judged-per-manifest @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario Outline: CI gates in the report are judged per manifest and name the manifest that failed
    Given the project's CI gates allow at most <limit> libyears of drift
    And manifest "api" has <api> libyears of drift and manifest "web" has <web> libyears
    When the developer opens the report
    Then the report shows <banner>
    And each failure is prefixed with the label of the manifest it came from

    Examples:
      | limit | api   | web  | banner                                                                               |
      | 10    | 6.00  | 7.00 | "Gates pass — the same checks depwatch check --ci runs."                             |
      | 10    | 12.50 | 7.00 | "1 gate(s) failing" with "api: total drift 12.50 libyears exceeds --max-libyears 10" |

  @id:vscode.reports.report-panel.015 @rule:reports.report-panel.deep-tier-only-when-all-deep @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario Outline: The report claims a deep scan only when every manifest was deep scanned
    Given <deep> of the <total> scanned manifests were deep scanned
    When the developer opens the report
    Then the report footer says <tier>

    Examples:
      | deep | total | tier                                                                                        |
      | 2    | 2     | "deep scan: maintainers, funding, archived status and last commit"                          |
      | 1    | 2     | "default scan: release timeline only — run a deep scan for maintainers and archived status" |

  @id:vscode.reports.report-panel.016 @rule:reports.report-panel.settings-apply-immediately @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario: Changing thresholds or gates updates an open report straight away
    Given the report tab is open and visible
    And the stale threshold is 2 libyears
    When the developer changes the stale threshold to 5 libyears in settings
    Then the report footer shows "behind > 5 libyears"
    And the quadrant charts are redrawn with the new threshold line straight away
    And a background rescan follows to re-place dependencies in their quadrants
