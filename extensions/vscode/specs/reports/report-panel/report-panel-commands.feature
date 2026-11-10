@domain:reports @area:report-panel @from:src/commands
Feature: Opening the report and jumping to a dependency
  Gives a developer the report even before they have scanned, and takes them from a report row to the declaring line.

  @id:vscode.reports.report-panel.001 @rule:reports.panel.scan-before-first-show @inferred @source:extensions/vscode/src/commands.ts#report
  Scenario: Opening the report with no findings yet scans the workspace first
    Given no scan has run in this window
    When the developer opens the report
    Then the workspace is scanned without a progress notification
    And the report tab opens with the scan's findings

  @id:vscode.reports.report-panel.002 @rule:reports.panel.row-jumps-to-dependency @inferred @source:extensions/vscode/src/commands.ts#pane
  Scenario: Choosing a dependency in the report opens its manifest with the dependency selected
    Given the report lists "lodash" from package.json
    When the developer clicks the "lodash" row
    Then package.json opens in a preview editor
    And the text declaring "lodash" is selected and scrolled into view
    And if "lodash" cannot be found in the file, the file opens with nothing selected
